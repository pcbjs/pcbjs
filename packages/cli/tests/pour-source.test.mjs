// Pours and stitching vias carry the range of the call that made them: a pour() as a <PCB> child, one on no net, a pour in a
// circuit's layout and in an instance's own layout, and stitch() with and without options, through the transform, the compiler and the index.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import { compileBoard } from '@pcbjs/compile'
import { sourceIndex } from '@pcbjs/export/internal/site-data'
import { rangeFor } from '@pcbjs/ui'
import { transformSourceRanges } from '../dist/project/source-ranges.js'
// the transform's text hashes, which tests/source-ranges.test.mjs checks, left out of the literals compared here
const plain = s => s.replace(/, hash: "[0-9a-f]{12}"/g, '')

const code = `import PCB, { nets, pour, stitch, circuit, layout, type Ports } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
const { GND, VCC } = nets()
const cell = circuit('cell', ({ V, G }: Ports<'V' | 'G'>) => ({ R: R0603('1k').connect({ 1: V, 2: G }) }))
const P1 = cell({ V: VCC, G: GND }, 2)
const CH1 = cell({ V: VCC, G: GND }, 1)
const Row = layout(cell, (g, { at }) => (
  <g at={at}>
    <g.R at="5 0" />
    {pour(g.ports.G, 'F.Cu', 'M 0 -2 H 10 V 2 H 0 Z')}
  </g>
))
const Grp = layout(P1, (g, { at }) => (
  <g at={at}>
    <g.R at="5 0" />
    {pour(GND, 'F.Cu', 'M 0 -2 H 10 V 2 H 0 Z', { priority: 1 })}
  </g>
))
export default (
  <PCB name="P">
    <rect layer="Edge.Cuts" x={0} y={0} w={40} h={30} />
    {pour(GND, 'B.Cu', 'M 0 0 H 40 V 30 H 0 Z', { islands: 'keep' })}
    {pour(GND, 'F.Cu', 'M 20 20 H 30 V 28 H 20 Z', { islands: 'keep' })}
    {pour(null, 'F.Cu', 'M 32 2 H 38 V 8 H 32 Z')}
    {stitch(GND)}
    {stitch(GND, { pitch: 3 })}
    <Row g={CH1} at="0 5" />
    <Grp g={P1} at="0 12" />
  </PCB>
)
`
const lines = code.split('\n')
const text = r => (r.start[0] === r.end[0] ? lines[r.start[0] - 1].slice(r.start[1] - 1, r.end[1]) : null)
let dir, board, sources

before(async () => {
  dir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.pour-'))
  const t = plain(transformSourceRanges(code, join(dir, 'board.tsx'), 'board.tsx').code)
  writeFileSync(join(dir, 'board.mjs'), (await transform(t, { loader: 'tsx', jsx: 'automatic', jsxImportSource: '@pcbjs/core', format: 'esm' })).code)
  board = compileBoard((await import(pathToFileURL(join(dir, 'board.mjs')).href)).default)
  sources = sourceIndex(board, f => f)
})
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

// the range the viewer opens for an item
const rangeOf = it => rangeFor(sources, { uid: it.uid }).range

test('stitch(net) keeps its net and gets the range as an argument of its own', () => {
  const out = plain(transformSourceRanges(code, '/p/board.tsx', 'board.tsx').code)
  assert.ok(out.includes(`stitch(GND, { __src: { file: "board.tsx", line: 25, col: 6, endLine: 25, endCol: 16 } })`), out)
  assert.ok(out.includes(`stitch(GND, { pitch: 3, __src: { file: "board.tsx", line: 26, col: 6, endLine: 26, endCol: 30 } })`), out)
})

test('a layout element lists the items drawn inside it as outer', () => {
  const row = sources['board.tsx'].find(r => text(r) === '<Row g={CH1} at="0 5" />')
  const zone = board.items.find(i => i.kind === 'zone' && i.layer === 'F.Cu' && row.uids.includes(i.uid))
  assert.ok(zone && row.outer.includes(zone.uid))
})

test('every pour opens its whole pour() call', () => {
  const zones = board.items.filter(i => i.kind === 'zone')
  assert.deepEqual(zones.map(z => text(rangeOf(z))).sort(), [
    `pour(GND, 'B.Cu', 'M 0 0 H 40 V 30 H 0 Z', { islands: 'keep' })`,
    `pour(GND, 'F.Cu', 'M 0 -2 H 10 V 2 H 0 Z', { priority: 1 })`,
    `pour(GND, 'F.Cu', 'M 20 20 H 30 V 28 H 20 Z', { islands: 'keep' })`,
    `pour(g.ports.G, 'F.Cu', 'M 0 -2 H 10 V 2 H 0 Z')`,
    `pour(null, 'F.Cu', 'M 32 2 H 38 V 8 H 32 Z')`,
  ])
})

test('stitching vias open their stitch() call', () => {
  const vias = board.items.filter(i => i.kind === 'via' && i.stitch)
  const calls = new Set(vias.map(v => text(rangeOf(v))))
  assert.deepEqual([...calls].sort(), ['stitch(GND)', 'stitch(GND, { pitch: 3 })'])
})
