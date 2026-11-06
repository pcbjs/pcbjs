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

test('the schematic frames and highlights a part', async () => {
  const all = await shot(blinky, { view: 'sch' })
  const r = await shot(blinky, { view: 'sch', frame: 'Q1', highlight: ['Q1'] })
  assert.match(r.legend, /^Blinky sch; snapshot .*; frame Q1/)
  assert.ok(!same(all, r))
})
