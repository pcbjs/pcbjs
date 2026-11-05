// The 3D board scene built in Node from the fixture board: one draw per layer batch and per instanced model, the state each Paint gives
// every piece and body, the draws each state costs, that a paint applied as a difference leaves every mesh as a whole repaint would, and
// what a ray from above picks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import * as THREE from 'three'
import { fixture } from './fixture-board.mjs'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { BoardScene } = await import('../src/scene/board-scene.ts')
const { GeometryCache } = await import('../src/scene/items.ts')
const { litMeshes } = await import('../src/scene/lit.ts')
const { DARK, hoverLit, paintOf } = await import('../src/paint.ts')
const { drawnOf, emptySelection, isolationView, selectRefs } = await import('../src/selection.ts')

const square = [
  [-1, -1],
  [31, -1],
  [31, 31],
  [-1, 31],
]
// two vias of S2 through both layers: round holes, one instanced draw of plating
const via = (id, x) => ({
  id,
  uid: `item:0000000000${id}`,
  kind: 'via',
  net: 'S2',
  layers: ['F.Cu', 'B.Cu'],
  drill: 0.3,
  rings: [
    [
      [x - 0.3, 19.7],
      [x + 0.3, 19.7],
      [x + 0.3, 20.3],
      [x - 0.3, 20.3],
    ],
    [
      [x - 0.15, 19.85],
      [x + 0.15, 19.85],
      [x + 0.15, 20.15],
      [x - 0.15, 20.15],
    ],
  ],
})
function board() {
  const b = fixture([via(20, 20), via(21, 22)])
  return {
    ...b,
    thickness: 1.6,
    copper: 2,
    outline: [square],
    bbox: { x: -1, y: -1, w: 32, h: 32 },
    drills: [],
    keepouts: [],
    footprints: b.footprints.map(f => ({ ...f, height: 0.5, body: { x: f.at[0], y: f.at[1], w: 2, h: 1, rot: 0 } })),
  }
}
// every part the same model, so the four bodies are one instanced draw
const boxGeo = new THREE.BoxGeometry(2, 1, 0.5),
  boxMat = new THREE.MeshStandardMaterial()
const body = () => new THREE.Mesh(boxGeo, boxMat)
function scene(b = board()) {
  const s = new BoardScene({ css: (_n, f) => f, cache: new GeometryCache(), pool: null, body, changed: () => {} })
  s.setFacets(b, new Set(['meta', 'layers', 'shapes']))
  s.root.updateMatrixWorld(true)
  return { s, b }
}
const all = s => {
  const out = []
  s.root.traverse(o => out.push(o))
  return out
}
const meshes = s => all(s).filter(o => o.isMesh)
const batches = s =>
  all(s)
    .filter(o => o.userData.batch?.pick === o)
    .map(o => o.userData.batch)
/** the batch of a layer group's items or bodies, never the one drawing items over their merged copper */
const batchOf = (s, group) => batches(s).find(b => b.group.name === group && !b.pieces.some(p => p.under))
const mergedId = (s, net, group = 'F.Cu') => batchOf(s, group).pieces.find(p => p.items && p.net === net)?.id
const st = (s, id, group = 'F.Cu') => batchOf(s, group).stateOf(id)
/** the drawn state of a part's body in the body batch, undefined when it is not drawn there */
const bodyHl = (s, ref) => {
  const bt = batchOf(s, 'bodies:F')
  const v = bt.stateOf(bt.pieces.find(p => p.ref === ref).id)
  return v === 'gone' ? undefined : v
}
const bodyOf = (s, ref) => meshes(s).find(m => m.parent?.parent?.userData.ref === ref)
/** the items drawn over their merged copper, each with its state */
const shownMembers = s => batches(s).flatMap(b => b.pieces.filter(p => p.under).map(p => [p.id, p.st]))
const hl = m => m.userData.hl ?? null
const paint = (b, refs, o = {}) => {
  const sel = refs.length ? selectRefs(emptySelection(), refs, o.anchor ?? refs.at(-1)) : emptySelection()
  return paintOf(b, drawnOf(b, sel), o.hover ?? DARK, o.iso ?? null, o.stale, o.hidden ?? new Set(), o.fade ?? true)
}
const state = s => meshes(s).map(m => `${m.uuid}:${hl(m)}:${m.visible}:${m.material.uuid}:${m.count ?? ''}:${m.geometry.index?.count ?? ''}`)

/** The draw calls a renderer makes of the scene, as three.js counts them: each visible mesh, line or instanced set with copies, per material group, a double-sided transparent material twice; no frustum culling. */
function draws(root) {
  let n = 0
  const walk = o => {
    if (!o.visible) return
    if ((o.isMesh || o.isLine) && !(o.isInstancedMesh && o.count === 0) && o.geometry.attributes.position) {
      const mats = Array.isArray(o.material) ? o.geometry.groups.map(g => o.material[g.materialIndex]) : [o.material]
      for (const m of mats) if (m?.visible) n += m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass ? 2 : 1
    }
    o.children.forEach(walk)
  }
  walk(root)
  return n
}

test('the copper of a net on a layer with several items is one merged piece of the layer batch, its items members drawn by no mesh of their own', () => {
  const { s } = scene()
  const cu = batchOf(s, 'F.Cu')
  const gnd = cu.info(mergedId(s, 'GND'))
  assert.deepEqual(
    gnd.items.map(i => i.id).sort((a, b) => a - b),
    [4, 6, 8, 11],
  )
  assert.ok(cu.has(1) && !cu.has(4), 'a lone item is a piece, an item of merged copper is not')
  assert.deepEqual(shownMembers(s), [])
  assert.equal(meshes(s).filter(m => m.userData.under).length, 0, 'no item’s own mesh is built up front')
  // the skins of each side are a batch, and so is the back copper the vias reach
  assert.ok(batchOf(s, 'F.Mask') && batchOf(s, 'B.Cu'))
})

test('at rest every batch, the barrels and the bodies are one draw each', () => {
  const { s, b } = scene()
  s.paint(paint(b, []), null)
  const twins = all(s).filter(o => o.isInstancedMesh && o.visible && o.count > 0)
  assert.deepEqual(
    twins.map(t => [t.parent.name, t.count]),
    [['barrels', 2]],
  )
  const drawn = all(s).filter(o => o.isMesh && o.visible && (o.parent.name.endsWith('.Cu') || o.parent.name === 'bodies:F'))
  assert.equal(drawn.length, 3, 'the front copper, the back copper and the four bodies, one draw each')
  // the copper and skin batches of each side, the bodies, the plating, the core's lids and sides and the two mask slabs
  assert.equal(batches(s).length, 5)
  assert.equal(draws(s.root), 10)
})

test('a part under the fade: its pads lit in the batch, the rest of each batch faded, the item inside merged copper drawn over it, its body rimmed', () => {
  const { s, b } = scene()
  const rest = draws(s.root)
  assert.equal(s.paint(paint(b, ['R1']), null), 'scene')
  assert.equal(st(s, 1), null)
  assert.equal(st(s, mergedId(s, 'B')), 'fade')
  assert.equal(st(s, mergedId(s, 'GND')), 'fade')
  // R1/2 sits inside B's merged copper, which fades; its own mesh is drawn over it with the rim
  assert.deepEqual(shownMembers(s), [[2, 'rim']])
  assert.equal(bodyHl(s, 'R1'), 'rim')
  assert.equal(bodyHl(s, 'R2'), 'fade')
  assert.ok(s.outlines.anchor.includes(bodyOf(s, 'R1')))
  // a faded batch is its prepass and its blend, a lit one its own draw: the fade costs a few draws a batch, never one per item
  assert.equal(rest, 10)
  assert.equal(draws(s.root), 23)
  const cu = all(s).filter(o => o.isMesh && o.visible && o.parent.name === 'F.Cu' && o.userData.pick === false && !o.userData.keepout)
  assert.deepEqual(cu.map(hl).sort(), [null, 'fade', 'rim'].sort(), 'the front copper in three draws: lit, faded, and R1/2 over its merged copper')
})

test('a pad as anchor: its own mesh outlined and drawn over the merged pour, its net lit as context', () => {
  const { s, b } = scene()
  s.paint(paint(b, ['R2/2']), null)
  assert.deepEqual(
    s.outlines.anchor.map(m => [m.userData.id, !!m.userData.under]),
    [[4, true]],
  )
  assert.ok(s.outlines.ctx.some(m => m.userData.id === mergedId(s, 'GND')))
  assert.ok(!s.outlines.ctx.some(m => m.userData.id === 4))
  assert.equal(st(s, mergedId(s, 'GND')), null)
  assert.deepEqual(shownMembers(s), [[4, 'rim']])
  // the parts on the context net stay in focus
  assert.equal(bodyHl(s, 'R101'), null)
  assert.equal(bodyHl(s, 'R1'), 'fade')
})

test('the outlined sets equal a scan of every piece and member by the lit rule', () => {
  const { s, b } = scene()
  // every item of the front copper as the rule reads it: a lone one by itself, one inside merged copper under its net's piece
  const cu = batchOf(s, 'F.Cu')
  const under = new Map(cu.pieces.filter(p => p.items).flatMap(p => p.items.map(i => [i.id, p])))
  const rows = [...cu.pieces.map(p => ({ userData: p })), ...[...under].map(([, p]) => p.items.map(i => ({ userData: { ...i, under: p } }))).flat()]
  const key = u => (u.items ? `net:${u.net}` : u.id)
  for (const refs of [['R1'], ['R2/2'], ['net:GND'], ['CH1'], ['route:1']]) {
    const p = paint(b, refs)
    s.paint(p, null)
    const k = { ids: new Set(p.anchor.ids), parts: new Set(), nets: new Set(p.anchor.nets) }
    const want = new Set(
      litMeshes(rows, k)
        .filter(m => m.userData.layer === 'F.Cu')
        .map(m => key(m.userData)),
    )
    const got = new Set(s.outlines.anchor.filter(m => m.userData.id !== undefined && m.parent.name === 'F.Cu').map(m => key(m.userData)))
    assert.deepEqual([...got].sort(), [...want].sort(), refs.join())
  }
})

test('a paint applied as a difference leaves every mesh as a whole repaint does', () => {
  const { s, b } = scene()
  const stale = { ids: new Set([10]), refs: new Set(['R2']), nets: new Set(), findings: new Set(), gone: new Set() }
  const steps = [paint(b, ['R1']), paint(b, ['R2/2']), paint(b, ['net:GND']), paint(b, ['CH1'], { stale }), paint(b, ['R101']), paint(b, [])]
  let prev = null
  for (const p of steps) {
    s.paint(p, prev)
    const diffed = state(s)
    s.repaint()
    assert.deepEqual(diffed, state(s))
    prev = p
  }
})

test('a hover alone changes the outline, nothing else', () => {
  const { s, b } = scene()
  const a = paint(b, ['R1'])
  s.paint(a, null)
  const before = state(s)
  const h = { ...a, hover: hoverLit(b, selectRefs(emptySelection(), ['R1']), 'R2') }
  assert.equal(s.paint(h, a), 'outline')
  assert.deepEqual(state(s), before)
  assert.ok(s.outlines.hover.includes(bodyOf(s, 'R2')))
  assert.equal(s.paint({ ...h }, h), 'none')
})

test('a stale item leaves its batch for a see-through draw of its own state, and merged copper with a stale item goes with it', () => {
  const { s, b } = scene()
  const stale = { ids: new Set([10]), refs: new Set(), nets: new Set(), findings: new Set(), gone: new Set() }
  s.paint(paint(b, [], { stale, fade: false }), null)
  assert.equal(st(s, mergedId(s, 'B')), 'see', 'track 10 is inside B’s merged copper, which turns see-through whole')
  assert.equal(st(s, mergedId(s, 'GND')), null)
  const lone = { ids: new Set([1]), refs: new Set(), nets: new Set(), findings: new Set(), gone: new Set() }
  s.paint(paint(b, [], { stale: lone, fade: false }), null)
  assert.equal(st(s, 1), 'see')
  const split = all(s).filter(o => o.isMesh && o.visible && o.parent.name === 'F.Cu' && o.userData.pick === false && !o.userData.keepout)
  assert.deepEqual(split.map(hl).sort(), [null, 'see'].sort())
  assert.equal(split.find(m => hl(m) === 'see').geometry.index.count, 36, 'the see-through draw holds the pad’s twelve triangles')
})

test('an isolation hides what it leaves out and draws an item of merged copper it keeps alone; a faded one fades it', () => {
  const { s, b } = scene()
  const iso = isolationView(b, { ref: 'CH1', context: 'CH1', instances: ['CH1', 'CH2'], preview: false })
  s.paint(paint(b, [], { iso: { ...iso, fade: false } }), null)
  assert.equal(st(s, mergedId(s, 'S1')), null)
  assert.equal(st(s, 1), 'gone')
  assert.equal(st(s, mergedId(s, 'GND')), 'gone')
  assert.deepEqual(shownMembers(s), [[6, null]], 'R101/2 of the GND pour drawn alone')
  assert.equal(bodyHl(s, 'R1'), undefined)
  assert.equal(bodyHl(s, 'R101'), null)
  // a ray along the front copper, past R101's body, meets R101/2 through its own mesh, the pour it sits in left out; one over R1/1 finds no copper
  const along = s.pick(new THREE.Ray(new THREE.Vector3(11.5, 5, 1.62), new THREE.Vector3(0, -1, 0)), { ids: new Set(), refs: new Set(['R101']) })
  assert.equal(along.info.id, 6)
  assert.equal(s.pick(new THREE.Ray(new THREE.Vector3(0.5, -4.9, 20), new THREE.Vector3(0, 0, -1)), { ids: new Set(), refs: new Set() })?.info?.id ?? null, null)
  s.paint(paint(b, [], { iso: { ...iso, fade: true } }), null)
  assert.equal(st(s, 1), 'fade')
  assert.equal(st(s, mergedId(s, 'GND')), 'fade', 'merged copper an isolation leaves partly out fades with the batch')
  assert.equal(bodyHl(s, 'R1'), 'fade')
})

test('a ray from above picks the pad over the pour, a via’s plating, never a stale one', () => {
  const { s } = scene()
  // the track of S1 over the GND pour, both merged copper, clear of every body
  const ray = new THREE.Ray(new THREE.Vector3(10.5, -7.5, 20), new THREE.Vector3(0, 0, -1))
  assert.equal(s.pick(ray, { ids: new Set(), refs: new Set() }).info.id, 9)
  assert.equal(s.pick(new THREE.Ray(new THREE.Vector3(1, -5, 20), new THREE.Vector3(0, 0, -1)), { ids: new Set(), refs: new Set() }).info.ref, 'R1')
  const zone = s.pick(new THREE.Ray(new THREE.Vector3(25, -25, 20), new THREE.Vector3(0, 0, -1)), { ids: new Set(), refs: new Set() })
  assert.equal(zone.info.kind, 'zone')
  assert.deepEqual(zone.at, [25, 25])
  assert.equal(s.pick(ray, { ids: new Set([9]), refs: new Set() }).info.id, 11)
  // sideways through the board at the via's centre: the plating's instance names the via
  const side = s.pick(new THREE.Ray(new THREE.Vector3(20, -10, 0.8), new THREE.Vector3(0, -1, 0)), { ids: new Set(), refs: new Set() })
  assert.equal(side.info.id, 20)
})

test('a body a drag moves leaves its batch for its own mesh, which moves with the part', () => {
  const { s } = scene()
  const mesh = bodyOf(s, 'R1')
  const where = () => {
    s.root.updateMatrixWorld(true)
    return new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld)
  }
  const at = where()
  assert.equal(mesh.visible, false)
  s.pose({ parts: new Set(['R1']), ids: new Set(), origin: [1, 5], delta: [3, 0], angle: 0, held: { meta: true, layers: false }, done: false })
  assert.equal(bodyHl(s, 'R1'), undefined)
  assert.equal(mesh.visible, true)
  assert.ok(Math.abs(where().x - at.x - 3) < 1e-9)
  s.pose(null)
  assert.equal(bodyHl(s, 'R1'), null)
  assert.equal(mesh.visible, false)
  assert.ok(where().distanceTo(at) < 1e-9)
})

test('a pose draws its parts’ pads and its items of no part again where it goes, an instance’s route and via among them, while it holds layers', () => {
  const { s } = scene()
  const pose = held => ({ parts: new Set(['R1']), ids: new Set([9, 20]), origin: [1, 5], delta: [3, 0], angle: 0, held, done: false })
  s.pose(pose({ meta: true, layers: true }))
  const ids = new Set(s.ghosts.children.map(g => g.userData.id))
  const pads = s.board.items.filter(it => it.kind === 'pad' && it.ref === 'R1').map(it => it.id)
  for (const id of [...pads, 9, 20]) assert.ok(ids.has(id), `item ${id} drawn again`)
  assert.ok(s.ghosts.children.filter(g => g.userData.id === 20).length >= 2, 'the via’s copper and its plating')
  const posed = new Set([...pads, 9, 20])
  const hidden = batchOf(s, 'F.Cu').pieces.filter(p => posed.has(p.id) || p.items?.some(i => posed.has(i.id)))
  for (const p of hidden) assert.equal(st(s, p.id), 'gone', 'original copper hidden per piece')
  for (const p of batchOf(s, 'F.Cu').pieces.filter(p => !hidden.includes(p))) assert.notEqual(st(s, p.id), 'gone', 'unrelated batch pieces retained')
  const members = shownMembers(s)
  for (const p of hidden)
    for (const i of p.items ?? [])
      if (!pads.includes(i.id) && i.id !== 9 && i.id !== 20)
        assert.ok(
          members.some(([id]) => id === i.id),
          `unrelated merged member ${i.id} retained`,
        )
  const track = s.ghosts.children.find(g => g.userData.id === 9)
  track.geometry.computeBoundingBox()
  const at = track.geometry.boundingBox.getCenter(new THREE.Vector3())
  s.ghosts.updateMatrixWorld(true)
  const moved = at.clone().applyMatrix4(track.matrixWorld)
  const rest = at.clone().applyMatrix4(track.matrix)
  assert.ok(Math.abs(moved.x - rest.x - 3) < 1e-9 && Math.abs(moved.y - rest.y) < 1e-9, 'the route moved 3 mm')
  s.pose(pose({ meta: true, layers: false }))
  assert.equal(s.ghosts.children.length, 0, 'the layers facet draws the result: nothing drawn again')
  for (const p of hidden) assert.notEqual(st(s, p.id), 'gone', 'originals restored after layers acknowledgement')
  s.pose(pose({ meta: false, layers: true }))
  for (const p of hidden) assert.equal(st(s, p.id), 'gone', 'meta arriving first keeps copper held')
  s.pose(null)
  assert.equal(s.ghosts.children.length, 0)
  for (const p of hidden) assert.notEqual(st(s, p.id), 'gone', 'cancellation restores originals')
})

test('unbiased mask depth and transparent layer ordering survive an exploded back-mask hover round trip', () => {
  const { s, b } = scene()
  s.paint(paint(b, [], { fade: false }), null)
  s.explode(4)
  const skins = meshes(s).filter(m => m.parent?.name?.endsWith('.Mask') && m.userData.slabKey)
  assert.equal(skins.length, 2)
  const base = skins.map(m => ({ mesh: m, material: m.material, z: m.parent.position.z, order: m.renderOrder }))
  for (const m of skins) {
    assert.equal(m.material.polygonOffset, false)
    assert.equal(m.renderOrder, 0, 'sort transparent layers by depth together')
  }
  s.hoverLayer('B.Mask')
  s.step(performance.now() + 1000)
  s.hoverLayer(null)
  s.step(performance.now() + 2000)
  s.step(performance.now() + 3000)
  for (const x of base) {
    assert.equal(x.mesh.material, x.material)
    assert.equal(x.mesh.renderOrder, x.order)
    assert.equal(x.mesh.parent.position.z, x.z)
  }
  s.dispose()
})
