// The tools in 3D: a press picks through the selection geometry and the tool handles, a drag on the part's plane sends the same updates
// as the 2D drag of the same displacement, the ring keeps its stops, R and the side flip, a control point drag, the assist's dots
// where the 2D ones are, and a click on a dot writing the argument; all through the same session calls as the 2D view.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import * as THREE from 'three'
import { shapeOf } from '@pcbjs/core/site-shapes'
import { fixture } from './fixture-board.mjs'
import { facetSet } from '@pcbjs/core/site-facets'

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
const { nextTick } = await import('vue')
const { createViewer } = await import('../src/shell.ts')
const { useGesture } = await import('../src/gesture.ts')
const { useTools3d, onPlane, gridSegments } = await import('../src/tools3d.ts')
const { dotField } = await import('../src/dots.ts')
const { ToolLayer } = await import('../src/scene/tools.ts')
const { ringShape } = await import('../src/ring.ts')
const { bestHit, toolHitOf } = await import('../src/scene/pick.ts')
const { ItemPicker } = await import('@pcbjs/export/internal/scene/merge')
const { LayerBatch } = await import('../src/scene/batch.ts')

const W = 800,
  H = 600,
  PX = 0.05
/** the front copper's face */
const Z = 1.6
const COLORS = { accent: '#2563eb', rim: '#ffffff', panel: '#17191f', dim: '#8a8f98', copper: '#c8a050' }

/** The fixture with R1 placed on grid g, 1 mm with halves, and route:1 a chain of one L call, compiled in dev. */
function board() {
  const b = fixture()
  b.dev = { snapshot: 's1' }
  b.bbox = { x: 0, y: 0, w: 30, h: 30 }
  b.grids = [{ name: 'g', pitch: 1, minor: [2], origin: [0, 0], angle: 0, mirror: false, frame: null }]
  b.edit = [
    { ref: 'R1', caps: ['placed', 'layered'], src: { at: { file: 'pcb.tsx', line: 3, col: 5 } }, m: [1, 0, 0, 1, 0, 0], grid: 'g', at: [1, 5, 0], side: 'F' },
    {
      ref: 'route:1',
      caps: ['chain'],
      src: { chain: { file: 'pcb.tsx', line: 9, col: 1 } },
      m: [1, 0, 0, 1, 0, 0],
      grid: null,
      steps: [{ op: 'L', src: { file: 'pcb.tsx', line: 9, col: 20 } }],
    },
  ]
  return b
}

/** A session that records every call, as `session/edit/*` would receive them. */
function session() {
  const calls = []
  let n = 0
  const client = {
    begin: async p => (calls.push(['begin', p]), { txn: `t${++n}`, tools: [] }),
    update: async (txn, u) => (calls.push(['update', u]), { files: [{ file: 'pcb.tsx', edits: [] }], notes: [] }),
    commit: async txn => (calls.push(['commit', txn]), { written: [{ file: 'pcb.tsx', via: 'editor', applied: true }] }),
    cancel: async txn => (calls.push(['cancel', txn]), null),
  }
  return { calls, client }
}

/** The board's store on a page whose edit session has `client`. */
function viewer(b, client) {
  const store = createViewer({ boards: [facetSet(b)], single: true, path: '/', baseUrl: '/' }).board(b.name)
  store.edit.client = client
  store.edit.mode = { mode: 'rw', editor: true }
  return store
}

/** A camera looking down at the board from the front and above, as the iso preset does. */
function camera() {
  const c = new THREE.PerspectiveCamera(35, W / H, 0.1, 1000)
  c.up.set(0, 0, 1)
  c.position.set(18, -60, 50)
  c.lookAt(12, -6, 0)
  c.updateMatrixWorld()
  return c
}
/** The screen point of a board point at a height, as clientX and clientY in a W by H pane. */
function screen(cam, p, z = Z) {
  const v = new THREE.Vector3(p[0], -p[1], z).project(cam)
  return { clientX: ((v.x + 1) / 2) * W, clientY: ((1 - v.y) / 2) * H }
}
function rayOf(cam, e) {
  const r = new THREE.Raycaster()
  r.setFromCamera(new THREE.Vector2((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1), cam)
  return r
}
const zOf = layer => (layer === 'B.Cu' ? 0 : Z)
function tools3d(b, store, sel, cam, parts = sel.refs.filter(r => !r.startsWith('route:'))) {
  return useTools3d({
    board: () => b,
    sel: () => sel,
    drawn: () => ({ parts: new Set(parts), anchor: { ids: new Set() } }),
    store,
    planeAt: (e, layer) => {
      const r = rayOf(cam, e)
      return onPlane(r.ray.origin, r.ray.direction, zOf(layer))
    },
    px: () => PX,
  })
}
const ev = (e, mods = {}) => ({ button: 0, pointerId: 1, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, target: null, ...e, ...mods })
const tick = async () => {
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
}
const sent = calls => calls.filter(c => c[0] !== 'commit').map(c => c[1])

test('3D picking: a ray through merged copper names the pad by the selection geometry, a body names its part, a handle wins', () => {
  const cam = camera()
  const b = board()
  const pads = b.items.filter(i => i.kind === 'pad' && i.ref === 'R1')
  // one merged net plane over the board, as a net's union is, a piece of the layer's batch with the per-item picker the 3D view keeps
  const batch = new LayerBatch(new THREE.Group(), new THREE.MeshBasicMaterial(), { z: 0, scale: 1, order: 0 })
  const items = pads.map(p => ({ id: p.id, kind: 'pad', ref: p.ref, net: p.net, layers: p.layers, layer: 'F.Cu', pad: '1' }))
  const merged = {
    id: -1e6,
    kind: 'track',
    net: items[0].net,
    layers: ['F.Cu'],
    layer: 'F.Cu',
    items,
    merged: new ItemPicker(
      pads.map(p => shapeOf(b, p.id)),
      pads.map(() => 1),
    ),
  }
  batch.fill(batch.add(merged), new THREE.PlaneGeometry(40, 40).translate(15, -15, Z).toNonIndexed())
  batch.flush()
  batch.group.updateMatrixWorld(true)
  const at = screen(cam, [0.5, 5])
  const hit = bestHit(rayOf(cam, at).intersectObject(batch.pick))
  assert.equal(hit.info.id, pads[0].id)
  assert.deepEqual(toolHitOf(hit.info), { id: pads[0].id, ref: 'R1' })
  const body = new THREE.Group()
  body.userData.ref = 'R1'
  body.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1).translate(1, -5, Z + 0.5), new THREE.MeshBasicMaterial()))
  body.updateMatrixWorld(true)
  const top = bestHit(rayOf(cam, screen(cam, [1, 5], Z + 1)).intersectObject(body, true))
  assert.deepEqual(toolHitOf(top.info), { id: null, ref: 'R1' })

  const layer = new ToolLayer()
  const shape = ringShape([1, 5], 3, 0, 0, PX)
  layer.ring(shape, Z, PX, COLORS)
  layer.points({ pts: [{ k: 1, at: [11, 7] }], legs: [{ k: 1, at: [10.5, 7] }] }, null, Z, PX, COLORS)
  layer.root.updateMatrixWorld(true)
  const tri = shape.tri.reduce((a, p) => [a[0] + p[0] / 3, a[1] + p[1] / 3], [0, 0])
  assert.ok(tri[0] > 3.5 + shape.band / 2, 'the heading outside the band')
  assert.deepEqual(layer.handleAt(rayOf(cam, screen(cam, tri))), { tool: 'ring', k: undefined }, 'the heading triangle')
  assert.deepEqual(layer.handleAt(rayOf(cam, screen(cam, [1, 2]))), { tool: 'ring', k: undefined }, 'the ring band itself')
  assert.deepEqual(layer.handleAt(rayOf(cam, screen(cam, [11, 7]))), { tool: 'pt', k: 1 })
  assert.deepEqual(layer.handleAt(rayOf(cam, screen(cam, [10.5, 7]))), { tool: 'leg', k: 1 })
  assert.equal(layer.handleAt(rayOf(cam, screen(cam, [1, 5]))), null, 'the ring is open in the middle')
  layer.clear()
})

test('3D move: a drag on the part’s plane sends what the 2D drag of the same displacement sends, snapped and free', async () => {
  const cam = camera()
  for (const mods of [{}, { shiftKey: true }, { metaKey: true, ctrlKey: true }]) {
    const b = board()
    const sel = { refs: ['R1'], anchor: 'R1' }
    const two = session()
    const s2 = viewer(b, two.client)
    const t2 = useGesture({
      board: () => b,
      sel: () => sel,
      drawn: () => ({ parts: new Set(['R1']), anchor: { ids: new Set() } }),
      boardAt: e => e.at,
      px: () => PX,
      vb: () => [0, 0, 30, 30],
      store: s2,
    })
    const from = [1.2, 5.1],
      path = [
        [2.1, 5.3],
        [3.27, 6.04],
      ]
    assert.equal(t2.down(ev({ at: from, clientX: 0, clientY: 0 }), { ref: 'R1' }), true)
    for (const p of path) t2.move(ev({ at: p, clientX: 50, clientY: 50 }, mods))
    t2.up()

    const three = session()
    const t3 = tools3d(b, viewer(b, three.client), sel, cam)
    assert.equal(t3.down(ev(screen(cam, from)), { ref: 'R1', id: 1 }), true)
    for (const p of path) t3.move(ev(screen(cam, p), mods))
    t3.up()
    await tick()
    assert.deepEqual(three.calls[0], ['begin', { board: 'Fx', run: null, tool: 'move', refs: ['R1'], anchor: 'R1' }])
    assert.deepEqual(sent(three.calls), sent(two.calls))
    assert.equal(three.calls.at(-1)[0], 'commit')
  }
  // the snapped drag lands on the half-millimetre grid
  const b = board()
  const s = session()
  const t3 = tools3d(b, viewer(b, s.client), { refs: ['R1'], anchor: 'R1' }, cam)
  t3.down(ev(screen(cam, [1, 5])), { ref: 'R1' })
  t3.move(ev(screen(cam, [3.1, 5.2])))
  assert.deepEqual(t3.pose.value.delta, [2, 0])
  t3.up()
  await tick()
  assert.deepEqual(s.calls[1], ['update', { delta: [2, 0], free: false }])
})

test('3D ring: stops of 15 degrees from the grid, 5 with shift, free to 0.1; R turns 90 and L flips the side', async () => {
  const cam = camera()
  const b = board()
  const s = session()
  const t3 = tools3d(b, viewer(b, s.client), { refs: ['R1'], anchor: 'R1' }, cam)
  const ring = t3.tl.ring.value
  assert.ok(ring, 'the ring shows for a placed part')
  assert.deepEqual(ring.c, [1, 5])
  const at = deg => [1 + 3 * Math.cos((deg * Math.PI) / 180), 5 - 3 * Math.sin((deg * Math.PI) / 180)]
  for (const [deg, mods, want] of [
    [50, {}, 45],
    [50, { shiftKey: true }, 50],
    [52, {}, 45],
    [37.26, { metaKey: true, ctrlKey: true }, 37.3],
  ]) {
    s.calls.length = 0
    assert.equal(t3.down(ev(screen(cam, at(0))), { tool: 'ring' }), true)
    t3.move(ev(screen(cam, at(deg)), mods))
    t3.up()
    await tick()
    assert.equal(s.calls[0][1].tool, 'rotate')
    assert.ok(Math.abs(s.calls[1][1].angle - want) < 0.051, `${deg} ${JSON.stringify(mods)} gives ${s.calls[1][1].angle}`)
  }
  s.calls.length = 0
  assert.equal(t3.command('rotate'), true)
  await tick()
  assert.deepEqual(sent(s.calls), [{ board: 'Fx', run: null, tool: 'rotate', refs: ['R1'], anchor: 'R1' }, { angle: 90 }])
  s.calls.length = 0
  assert.equal(t3.command('side'), true)
  await tick()
  assert.deepEqual(sent(s.calls), [{ board: 'Fx', run: null, tool: 'layer', refs: ['R1'], anchor: 'R1' }, { side: 'B' }])
  assert.equal(s.calls.at(-1)[0], 'commit')
})

test('3D control points: a drag of pt:1 on the route’s layer moves its call’s end, as in 2D', async () => {
  const cam = camera()
  const b = board()
  const s = session()
  const t3 = tools3d(b, viewer(b, s.client), { refs: ['route:1'], anchor: 'route:1' }, cam)
  assert.equal(t3.tl.tool.value, 'point')
  assert.deepEqual(t3.tl.points.value.pts, [{ k: 1, at: [11, 7] }])
  assert.equal(t3.plane.value, 'F.Cu')
  assert.equal(t3.down(ev(screen(cam, [11, 7])), { tool: 'pt', k: 1 }), true)
  t3.move(ev(screen(cam, [11, 8])))
  t3.move(ev(screen(cam, [11.5, 9.25])))
  t3.up()
  await tick()
  assert.deepEqual(s.calls[0][1], { board: 'Fx', run: null, tool: 'point', refs: ['route:1'], anchor: 'route:1/pt:1' })
  assert.deepEqual(s.calls.at(-2)[1], { point: { at: [12, 9] }, free: false })
  assert.equal(s.calls.at(-1)[0], 'commit')
})

test('3D assist: the dots stand where the 2D ones do, on the chain’s layer, and a click on one writes it', async () => {
  const cam = camera()
  const b = board()
  const s = session()
  const store = viewer(b, s.client)
  const t3 = tools3d(b, store, { refs: [], anchor: null }, cam)
  const ctx = {
    board: 'Fx',
    command: 'H',
    relative: false,
    ref: 'route:1',
    start: [10, 7],
    pad: null,
    layer: 'F.Cu',
    net: 'S1',
    side: 'F',
    grid: null,
    width: 0.2,
    typed: [],
    open: true,
  }
  store.edit.assist = ctx
  await tick()
  assert.equal(t3.as.on.value, true)
  const flat = t3.dots.value.ok.flat().concat(t3.dots.value.off.flat())
  const want = dotField(ctx, b).map(d => d.at)
  assert.ok(want.length > 10)
  assert.deepEqual(new Set(flat.map(p => p.join())), new Set(want.map(p => p.join())))

  const layer = new ToolLayer()
  layer.dots(t3.dots.value, Z, 1, COLORS)
  const drawn = []
  layer.root.traverse(o => {
    if (!o.isPoints) return
    const a = o.geometry.getAttribute('position')
    for (let i = 0; i < a.count; i++) drawn.push([a.getX(i), a.getY(i), a.getZ(i)])
  })
  assert.equal(drawn.length, want.length)
  for (const [x, y, z] of drawn) {
    assert.ok(Math.abs(z - Z) < 1e-6)
    // each drawn dot, seen through the camera, lands back on its 2D place
    const back = onPlane(...(r => [r.ray.origin, r.ray.direction])(rayOf(cam, screen(cam, [x, -y]))), Z)
    assert.ok(want.some(p => Math.hypot(p[0] - back[0], p[1] - back[1]) < 1e-3))
  }
  layer.clear()

  const e = ev(screen(cam, [13, 7]))
  t3.move(e)
  await tick()
  assert.deepEqual(t3.as.hover.value?.at, [13, 7])
  assert.equal(t3.down(e, {}), true)
  await tick()
  const begin = s.calls.findLast(c => c[0] === 'begin')
  assert.equal(begin[1].tool, 'assist')
  assert.deepEqual(s.calls.findLast(c => c[0] === 'update')[1].point, { at: [13, 7] })
  assert.equal(s.calls.at(-1)[0], 'commit')
  assert.equal(store.edit.last, 'pcb.tsx')
})

test('3D grid in effect: segments on the grid’s lines over the board, the pitch alone when the step is too dense', () => {
  const g = { name: 'g', pitch: 1, minor: [2], origin: [0, 0], angle: 0, mirror: false }
  const segs = gridSegments(g, [0, 0, 4, 2])
  assert.equal(segs.length / 4, 9 + 5)
  assert.deepEqual(segs.slice(0, 4), [0, 0, 0, 2])
  assert.equal(gridSegments(g, [0, 0, 200, 2]).length / 4, 201 + 3)
  assert.deepEqual(gridSegments(g, [0, 0, 1e6, 10]), [])
})

test('the ring of an instance sits on the origin of its layout frame, the same in 2D and 3D, never on the board origin', () => {
  const cam = camera()
  const b = board()
  // CH1's frame placed at 6 9 turned 30 degrees, its one part R1 at 1 5
  b.edit.push({ ref: 'CH1', caps: ['placed', 'layered'], src: { at: { file: 'pcb.tsx', line: 4, col: 5 } }, m: [1, 0, 0, 1, 0, 0], grid: null, at: [6, 9, 30], side: 'F' })
  const sel = { refs: ['CH1'], anchor: 'CH1' }
  const t3 = tools3d(b, viewer(b, session().client), sel, cam, ['R1'])
  const t2 = useGesture({
    board: () => b,
    sel: () => sel,
    drawn: () => ({ parts: new Set(['R1']), anchor: { ids: new Set() } }),
    boardAt: e => e.at,
    px: () => PX,
    vb: () => [0, 0, 30, 30],
    store: viewer(b, session().client),
  })
  for (const ring of [t2.ring.value, t3.tl.ring.value]) {
    assert.deepEqual(ring.c, [6, 9])
    const fp = b.footprints.find(f => f.ref === 'R1').bbox
    const far = Math.max(
      ...[
        [fp.x, fp.y],
        [fp.x + fp.w, fp.y],
        [fp.x, fp.y + fp.h],
        [fp.x + fp.w, fp.y + fp.h],
      ].map(p => Math.hypot(p[0] - 6, p[1] - 9)),
    )
    assert.ok(ring.r - ring.band / 2 > far, 'the band clears R1 about the instance origin')
    const apex = ring.tri[0]
    assert.ok(Math.abs((-Math.atan2(apex[1] - 9, apex[0] - 6) * 180) / Math.PI - 30) < 1e-6, 'the heading at its rotation')
  }
  assert.ok(t3.gridDots.value.flat().length, 'CH1 has no explicit grid: integer millimetre dots')
})

test('a part on a grid: its dots through its own origin in both views, gone while a control point tool or a lit grid shows', () => {
  const cam = camera()
  const b = board()
  b.edit[0].at = [1.2, 5, 0]
  const sel = { refs: ['R1'], anchor: 'R1' }
  const store = viewer(b, session().client)
  const t3 = tools3d(b, store, sel, cam)
  assert.equal(t3.tl.snapEnabled.value, false, 'the placement starts off its grid')
  t3.tl.snapOverride.value = true
  const pts = t3.gridDots.value.flat()
  assert.ok(
    pts.some(p => p[0] === 1.2 && p[1] === 5),
    'a dot on the origin',
  )
  assert.ok(
    pts.every(p => Math.abs((p[0] - 1.2) / 0.5 - Math.round((p[0] - 1.2) / 0.5)) < 1e-6 && Math.abs(p[1] / 0.5 - Math.round(p[1] / 0.5)) < 1e-6),
    'half a pitch apart through it',
  )
  store.edit.lit = { board: 'Fx', grid: 'g' }
  assert.deepEqual(t3.gridDots.value.flat(), [], 'an editor hover lighting a grid draws its lines instead')
})
