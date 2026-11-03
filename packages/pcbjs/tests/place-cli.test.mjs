// `pcbjs place --write`: each auto slot written into its part's `at`, the at:* props dropped, and the board compiled from the frozen source is the same.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filled, freezeEdits } from '@pcbjs/compile/internal/freeze'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(PKG, 'bin', 'pcbjs.js')

const cli = (cwd, ...args) =>
  new Promise(done => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NODE_ENV: 'production' }, timeout: 120000 }, (err, stdout, stderr) => {
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    })
  })

const BOARD = `import PCB, { nets, route, defineFootprint, h } from '@pcbjs/core'
const { A, B, C } = nets()
const Two = defineFootprint(
  p => h('footprint', p, h('pad', { num: 1, at: '-0.75 0', size: [0.8, 0.9], type: 'smd' }), h('pad', { num: 2, at: '0.75 0', size: [0.8, 0.9], type: 'smd' }), h('rect', { layer: 'F.CrtYd', x: -1.3, y: -0.8, w: 2.6, h: 1.6, width: 0.05 })),
  { pins: ['1', '2'] as const, prefix: 'R' },
)
const J1 = Two().connect({ 1: A, 2: B })
const J2 = Two().connect({ 1: A, 2: C })
const R1 = Two().connect({ 1: A, 2: B })
const R2 = Two().connect({ 1: B, 2: C })
const C1 = Two().connect({ 1: A, 2: C })
const trunk = route(J1[1], J2[1]).width(0.4)
export default (
  <PCB name="Frozen">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <J1 at="4 10" />
    <J2 at="26 10" />
    <R1 at="auto" at:initial="15 3" />
    <R2 at="15 auto 90" />
    <C1 at:follow={{ route: trunk, near: J2[1] }} />
    {trunk}
    {route(C1[2], J2[2])}
  </PCB>
)
`

let root
before(() => {
  root = mkdtempSync(join(tmpdir(), 'pcbjs-place-cli-'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(resolve(PKG, '..', '..', 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'pcb.tsx'), BOARD)
})
after(() => rmSync(root, { recursive: true, force: true }))

const where = async () => {
  const r = await cli(root, 'inspect', 'R1', 'R2', 'C1')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  // item uids hash the source range, which the edit shortens
  return r.stdout.replace(/item:[0-9a-f]+/g, 'item')
}

test('place --write: the placements written into the source compile to the same board, with no auto left', { timeout: 300000 }, async () => {
  const listed = await cli(root, 'place')
  assert.equal(listed.code, 0, listed.stdout + listed.stderr)
  assert.match(listed.stdout, /^pcb\.tsx {2}R1 {2}at="[-\d.]+ [-\d.]+ \d+" {2}placer {2}pcb\.tsx:18$/m)
  assert.match(listed.stdout, /^pcb\.tsx {2}C1 {2}at="[-\d.]+ [-\d.]+ \d+" {2}follow {2}pcb\.tsx:20$/m)
  const before = await where()
  const w = await cli(root, 'place', '--write')
  assert.equal(w.code, 0, w.stdout + w.stderr)
  assert.match(w.stdout, /^wrote pcb\.tsx: 4 edits$/m)
  const text = readFileSync(join(root, 'pcb.tsx'), 'utf8')
  assert.doesNotMatch(text, /auto|at:initial|at:follow/)
  assert.match(text, /<R2 at="15 [-\d.]+ 90" \/>/)
  assert.match(text, /<C1 at="[-\d.]+ [-\d.]+ \d+" \/>/)
  assert.equal(await where(), before)
  const again = await cli(root, 'place')
  assert.match(again.stdout, /no part with an auto slot/)
})

test('freeze: a lone auto takes the whole pose, a fixed slot keeps its text, a loop element is missed', () => {
  assert.equal(filled('auto', '1 2 90'), '1 2 90')
  assert.equal(filled('10mm auto 90deg', '10 4.5 90'), '10mm 4.5 90deg')
  const src = 'const x = parts.map(p => <Place part={p} at="auto" />)\n'
  const p = { ref: 'R1', at: '1 2 0', by: 'placer', src: { file: 'a.tsx', line: 1, col: 26 } }
  const r = freezeEdits('a.tsx', src, [p, { ...p, ref: 'R2' }])
  assert.equal(r.edits.length, 0)
  assert.equal(r.missed.length, 2)
  assert.equal(freezeEdits('a.tsx', src, [p]).edits[0].newText, '"1 2 0"')
})
