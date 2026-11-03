// The render spec on real boards through the renderer: top and bottom parts selected, one item of merged copper selected,
// hidden layers, an exploded stack with its marks anchored, a buried finding, a referenced board and a missing model.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../dist/project/config.js'
import { compileHere } from '../dist/project/local.js'
import { glbOf } from '../dist/project/project.js'
import { renderShot } from '../dist/render/render.js'
import { RenderWorker } from '../dist/render/worker-client.js'
import { readGlb } from '../dist/render/glb.js'
import { elevation } from '../dist/render/scene3d.js'
import { boardFindings } from '@pcbjs/export/internal/findings'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SIZE = [240, 180]

const FIX = `import PCB from '@pcbjs/fab/JLCPCB/4-Layer'
import { nets, pour, reference } from '@pcbjs/core'
import { R0603, rect } from '@pcbjs/lib'
const { SIG, GND } = nets()
const R1 = R0603('1k').connect({ 1: SIG, 2: GND })
const R2 = R0603('2k', { model: { file: './models/missing.step' } }).connect({ 1: SIG, 2: GND })
export default (
  <PCB name="Fix">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={12} />
    <R1 at="5 6" />
    <R2 at="15 6" side="B" />
    {pour(GND, 'In1.Cu', rect(20, 12))}
    {reference('../lid/pcb.tsx', { at: [0, 0, 6] })}
  </PCB>
)
`
const LID = `import PCB from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'
const J1 = PinHeader(2)()
export default (
  <PCB name="Lid">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={12} />
    <J1 at="10 6" />
  </PCB>
)
`
const CONFIG = "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n"

let root, worker, blinky, fix
const seen = []
const spy = { shot: (s, f, o) => (seen.push({ scene: s, frame: f, options: o }), worker.shot(s, f, o)) }

async function compile(dir, entries) {
  const cfg = await resolveConfig(entries, 'build', undefined, dir, () => {})
  const l = await compileHere(cfg)
  assert.deepEqual(l.errors, [])
  const c = l.slots[0].compiled[0]
  return { c, snapshot: l.snapshot, root: cfg.root, findings: boardFindings(c.board, cfg.root) }
}

before(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-render-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  for (const [d, src] of [
    ['fix', FIX],
    ['lid', LID],
  ]) {
    mkdirSync(join(root, d))
    writeFileSync(join(root, d, 'pcb.config.ts'), CONFIG)
    writeFileSync(join(root, d, 'pcb.tsx'), src)
  }
  worker = new RenderWorker()
  blinky = await compile(join(REPO, 'examples', 'demo'), ['blinky.pcb.tsx'])
  fix = await compile(join(root, 'fix'), [])
})

after(async () => {
  await worker?.close()
  if (root) rmSync(root, { recursive: true, force: true })
})

async function shot(b, spec, findings = b.findings) {
  seen.length = 0
  const r = await renderShot({
    compiled: b.c,
    glb: async () => glbOf(b.c, b.root),
    findings,
    project: b.root,
    snapshot: b.snapshot,
    spec: { size: SIZE, ...spec },
    worker: () => spy,
  })
  return { ...r, sent: seen[0] }
}

/** Each tEXt chunk of a PNG by keyword. */
function texts(png) {
  const out = {}
  const b = Buffer.from(png)
  for (let at = 8; at < b.length;) {
    const n = b.readUInt32BE(at)
    const type = b.toString('latin1', at + 4, at + 8)
    if (type === 'tEXt') {
      const body = b.toString('latin1', at + 8, at + 8 + n)
      const z = body.indexOf('\0')
      out[body.slice(0, z)] = body.slice(z + 1)
    }
    at += 12 + n
  }
  return out
}

const node = (b, name) => readGlb(glbOf(b.c, b.root)).byName.get(name)[0]
const same = (a, b) => Buffer.from(a.png).equals(Buffer.from(b.png))

test('the PNG carries the snapshot and the legend it returns', async () => {
  const r = await shot(blinky, { view: '3d' })
  const t = texts(r.png)
  assert.equal(t.Snapshot, blinky.snapshot)
  assert.equal(t.Legend, r.legend)
  assert.match(r.legend, /^Blinky 3d iso; snapshot /)
})

test('a part on top and one on the back, framed and highlighted', async () => {
  const plain = await shot(blinky, { view: '3d' })
  const top = await shot(blinky, { view: '3d', frame: 'R1', highlight: ['R1'] })
  assert.deepEqual(top.sent.frame.nodes, [node(blinky, 'part:R1')])
  assert.ok(top.sent.options.styles.some(s => s.nodes?.includes(node(blinky, 'part:R1')) && s.outline))
  const back = await shot(blinky, { view: '3d', side: 'B', frame: 'C1', highlight: ['C1'] })
  assert.deepEqual(back.sent.frame.nodes, [node(blinky, 'part:C1')])
  assert.ok(back.sent.frame.camera.direction[1] < 0, 'side B looks from below')
  assert.ok(!same(plain, top) && !same(top, back))
  const f2d = await shot(blinky, { view: '2d', frame: 'C1', highlight: ['C1'] })
  const b2d = await shot(blinky, { view: '2d', side: 'B', frame: 'C1', highlight: ['C1'] })
  assert.ok(!same(f2d, b2d), 'side B draws the back on top')
})

test('one item of the copper merged per net, selected by its uid', async () => {
  const track = blinky.c.site.items.find(it => it.kind === 'track' && it.layers.includes('F.Cu') && it.net === 'VCC')
  const r = await shot(blinky, { view: '3d', frame: track.uid, highlight: [track.uid] })
  assert.deepEqual(r.sent.frame.selections, [track.uid])
  assert.ok(r.sent.options.styles.some(s => s.selections?.[0] === track.uid))
  assert.ok(r.sent.scene.selection.some(g => g.id === track.uid && g.node === node(blinky, 'copper:F.Cu')))
  const net = await shot(blinky, { view: '3d', frame: track.uid, highlight: ['net:VCC'] })
  assert.ok(!same(r, net), 'the item alone is not its net')
})

test('shot --select on a pad inside merged copper: its own outline 2 px, 35 percent hidden, its net as 40 percent context', async () => {
  const site = blinky.c.site
  const pad = site.items.find(
    it => it.kind === 'pad' && it.ref && it.layers.join() === 'F.Cu' && site.items.some(t => t.kind === 'track' && t.net === it.net && t.layers.includes('F.Cu')),
  )
  const ref = `${pad.ref}/${site.footprints.find(f => f.ref === pad.ref).pads.find(p => p.net === pad.net).num}`
  // what `pcbjs shot --select <ref>` asks for, see shotJobs
  const r = await shot(blinky, { view: '3d', frame: ref, highlight: [ref] })
  const on = r.sent.scene.selection.filter(s => s.id === pad.uid).map(s => s.node)
  assert.ok(on.includes(node(blinky, 'copper:F.Cu')), 'the pad is an item of the merged F.Cu copper')
  const own = r.sent.options.styles.find(s => s.selections?.includes(pad.uid))
  assert.deepEqual([own.outline.width, own.outline.occludedAlpha], [2, 0.35])
  assert.ok(own.tint[3] < 0.2, 'a faint tint, no flood')
  const ctx = r.sent.options.styles.find(s => s.nodes?.includes(node(blinky, `net:${pad.net}`)))
  assert.ok(ctx && !ctx.tint && ctx.outline.color[3] === 0.4 && ctx.outline.width === 1.5, 'its net outlined as context, untinted')
  const plain = await shot(blinky, { view: '3d', frame: ref })
  assert.ok(!same(r, plain), 'the selection shows')
})

test('hidden layers: only the named stack groups drawn, the outline kept in 2D', async () => {
  const r = await shot(blinky, { view: '3d', layers: ['F.Cu'] })
  assert.deepEqual(r.sent.options.visibility, { only: [node(blinky, 'copper:F.Cu')] })
  const all = await shot(blinky, { view: '2d' })
  const cu = await shot(blinky, { view: '2d', layers: ['F.Cu'] })
  assert.ok(!same(all, cu))
  await assert.rejects(shot(blinky, { view: '3d', layers: ['F.Nothing'] }), /no layer group F.Nothing/)
})

test('an exploded stack moves each group, and a mark moves with its layer', async () => {
  const r = await shot(blinky, { view: '3d', camera: 'front', explode: 1, marks: [{ type: 'ring', at: [15, 10], layer: 'B.Cu' }] })
  const cu = node(blinky, 'copper:B.Cu')
  const moved = r.sent.options.nodeTranslations.find(t => t.node === cu)
  assert.ok(moved && moved.translation[1] < 0, 'B.Cu moves down')
  const [ring] = r.sent.options.annotations
  assert.equal(ring.node, cu)
  assert.equal(ring.depth, 'always', 'the back faces away from a front camera above the board')
})

test('a buried finding is marked at its inner layer, always visible', async () => {
  const f = {
    id: 'drc:clearance:000000000001',
    fingerprint: 'x',
    kind: 'drc',
    severity: 'error',
    rule: 'clearance',
    board: 'Fix',
    layer: 'In1.Cu',
    at: [10, 6],
    refs: [],
    items: [],
    src: [],
    message: 'clearance',
  }
  const r = await shot(fix, { view: '3d', findings: ['all'] }, [f])
  const ring = r.sent.options.annotations.find(a => a.type === 'ring')
  assert.equal(ring.depth, 'always')
  assert.equal(ring.node, node(fix, 'copper:In1.Cu'))
  assert.ok(Math.abs(ring.position[1] - elevation('In1.Cu', fix.c.site) / 1000) < 1e-9)
  assert.ok(r.sent.options.annotations.some(a => a.type === 'label'))
  assert.match(r.legend, /1 finding ringed/)
})

test('a referenced board is a node of its own and draws alone', async () => {
  const ref = readGlb(glbOf(fix.c, fix.root)).nodes.find(n => n.name.startsWith('reference:'))
  assert.ok(ref, 'the GLB holds the referenced board')
  const r = await shot(fix, { view: '3d', layers: ['references'] })
  assert.deepEqual(r.sent.options.visibility, { only: [ref.index] })
})

test('a part whose model file is missing keeps its body box and highlights', async () => {
  const r = await shot(fix, { view: '3d', side: 'B', frame: 'R2', highlight: ['R2'] })
  assert.deepEqual(r.sent.frame.nodes, [node(fix, 'part:R2')])
  assert.ok(r.width === SIZE[0] && r.height === SIZE[1])
})

test('the schematic frames and highlights a part', async () => {
  const all = await shot(blinky, { view: 'sch' })
  const r = await shot(blinky, { view: 'sch', frame: 'Q1', highlight: ['Q1'] })
  assert.match(r.legend, /^Blinky sch; snapshot .*; frame Q1/)
  assert.ok(!same(all, r))
})
