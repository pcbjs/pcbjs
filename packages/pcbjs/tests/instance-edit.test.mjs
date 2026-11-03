// The edit nodes of instances and texts as the session compiles them: a layout element's `at` is the placement of its instance, one
// level down for an instance in an instance, an element with no `at` leaves it computed, and a text gets its element unless a layout
// draws one per instance. Blinky from a scratch copy of the demo, and Nest, a scratch board with a pair of channels.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const NEST = `import PCB, { nets, circuit, layout } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'

const chan = circuit('chan', ({ VCC, SW }, { nets: { led } }) => {
  const R01 = R0603('330').connect({ 1: VCC, 2: led })
  const D01 = LED0603('green').connect({ A: led, K: SW })
  return { R01, D01 }
})
const pair = circuit('pair', ({ VCC, SW }) => {
  const A1 = chan({ VCC, SW }, 'A1')
  const B2 = chan({ VCC, SW }, 'B2')
  return { A1, B2 }
})
const Row = layout(chan, (g, { at, side }) => (
  <g at={at} side={side}>
    <g.R01 at="2 0" />
    <g.D01 at="6 0" />
  </g>
), 'Row')
const Pair = layout(pair, (g, { at }) => (
  <g at={at}>
    <Row g={g.A1} at="0 0 90" />
    <g at="10 0">
      <Row g={g.B2} />
    </g>
  </g>
), 'Pair')

export const { VCC, SW } = nets()
const P1 = pair({ VCC, SW }, 'P1')

export default (
  <PCB name="Nest">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <Pair g={P1} at="5 5" />
  </PCB>
)
`

let all
before(async () => {
  const { resolveConfig } = await import('@pcbjs/cli/internal/config')
  const { pluginState } = await import('@pcbjs/cli/internal/site')
  const { compileServer } = await import('@pcbjs/cli/internal/compile')
  const { viteLoader } = await import('@pcbjs/cli/internal/loader')
  const { compileEntry } = await import('@pcbjs/cli/internal/project')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-inst-')))
  cpSync(join(REPO, 'examples', 'demo'), root, { recursive: true, filter: s => !/\/(node_modules|\.pcbjs)(\/|$)/.test(s.slice(REPO.length)) })
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'nest.pcb.tsx'), NEST)
  const cfgFile = join(root, 'pcb.config.ts')
  writeFileSync(cfgFile, readFileSync(cfgFile, 'utf8').replace(/entries:\s*\[[^\]]*\]/, "entries: ['blinky.pcb.tsx', 'nest.pcb.tsx']"))
  const cfg = await resolveConfig([], 'build', undefined, root, () => {})
  const state = pluginState(cfg)
  const server = await compileServer(cfg)
  all = { root }
  try {
    for (const slot of state.slots) {
      const [c] = await compileEntry(viteLoader(server), cfg, slot.entry, { dev: true })
      all[c.board.name] = c
    }
  } finally {
    await server.close()
  }
})
after(() => all && rmSync(all.root, { recursive: true, force: true }))

const node = (b, ref) => all[b].site.edit.find(e => e.ref === ref)
const lineAt = (src, root = all.root) =>
  readFileSync(join(root, src.file), 'utf8')
    .split('\n')
    [src.line - 1].slice(src.col - 1)

test('Blinky: each channel is placed by the at of its <LedChannelRow>, in the board frame, its parts in the channel frame', () => {
  for (const [ch, y] of [
    ['CH1', 5],
    ['CH2', 10],
    ['CH3', 15],
  ]) {
    const n = node('Blinky', ch)
    assert.deepEqual(n.caps, ['placed', 'layered'])
    assert.deepEqual(n.at, [16, y, 0])
    assert.equal(n.side, 'F')
    assert.deepEqual(n.m, [1, 0, 0, 1, 0, 0])
    assert.equal(n.src.at.file, 'blinky.pcb.tsx')
    assert.ok(lineAt(n.src.at).startsWith(`<LedChannelRow g={${ch}} at="16 ${y}"`), lineAt(n.src.at))
    assert.ok(!n.computed)
  }
  assert.deepEqual(node('Blinky', 'R1').m, [1, 0, 0, 1, 16, 5], 'R1 is placed in the CH1 frame')
})

test('Blinky: a text of the board has its element, a label the layout draws for each channel has none', () => {
  const texts = all.Blinky.site.edit.filter(e => e.ref.startsWith('item:'))
  assert.deepEqual(
    texts.map(e => lineAt(e.src.at).split('>')[0] + '>'),
    ['<text layer="B.SilkS" at="15 8.3" size={0.8}>', '<text layer="F.SilkS" at="3 4.3" size={0.8}>', '<text layer="F.SilkS" at="15 18.5" size={1}>'],
  )
  for (const t of texts) {
    assert.deepEqual(t.caps, ['placed'])
    assert.ok(all.Blinky.site.items.some(i => i.uid === t.ref && i.kind === 'text'))
  }
  const labels = all.Blinky.site.items.filter(i => i.kind === 'text' && i.path)
  assert.equal(labels.length, 3)
  assert.ok(!labels.some(l => node('Blinky', l.uid)), 'no edit node for LED1, LED2 or LED3')
})

test('Nest: an instance in an instance is placed by its layout element in the parent layout, one level down; one with no at is computed', () => {
  const p1 = node('Nest', 'P1')
  assert.deepEqual(p1.at, [5, 5, 0])
  assert.match(lineAt(p1.src.at), /^<Pair g=\{P1\} at="5 5" \/>/)
  const a = node('Nest', 'P1/A1')
  assert.deepEqual(a.caps, ['placed', 'layered'])
  assert.deepEqual(a.at, [5, 5, 90])
  assert.deepEqual(a.m, [1, 0, 0, 1, 5, 5], 'written in the frame of the Pair render')
  assert.equal(a.src.at.file, 'nest.pcb.tsx')
  assert.match(lineAt(a.src.at), /^<Row g=\{g\.A1\} at="0 0 90" \/>/)
  const b = node('Nest', 'P1/B2')
  assert.equal(b.computed, true)
  assert.deepEqual(b.caps, [])
  assert.match(lineAt(b.src.at), /^<Row g=\{g\.B2\} \/>/)
})
