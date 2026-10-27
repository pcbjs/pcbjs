// `pcbjs model` in a project of two boards that share a ref: add and align refuse a bare ref on both and list the boards,
// `--entry` or `<board>/<ref>` picks one and --write edits that board's code only, and check's fixes name the board.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boardMatches, findFootprint, splitRef } from '../dist/model.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const board = (name, value, extra = '') => `import PCB from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'

const SW1 = R0603('${value}')
const R1 = R0603('1k')${extra}

export default (
  <PCB name="${name}">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={10} />
    <SW1 at="5 5" /><R1 at="12 5" />${extra ? '<R3 at="16 5" />' : ''}
  </PCB>
)
`
const BASE = board('Base', '10k')
const SENSE = board('Sense', '22k', "\nconst R3 = R0603({ value: '2k', model: { file: './models/nowhere.step' } })")

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-model-entry-')))
mkdirSync(join(root, 'node_modules'))
mkdirSync(join(root, 'models'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['base.tsx', 'sense.tsx'], vite: { logLevel: 'silent' } })\n")
writeFileSync(join(root, 'base.tsx'), BASE)
writeFileSync(join(root, 'sense.tsx'), SENSE)
copyFileSync(join(REPO, 'examples', 'highspeed', 'models', 'R_0603_1608Metric.step'), join(root, 'models', 'R.step'))
after(() => rmSync(root, { recursive: true, force: true }))

const run = (...args) => {
  const r = spawnSync(process.execPath, [BIN, 'model', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const read = f => readFileSync(join(root, f), 'utf8')

test('add with a ref on two boards refuses and lists them, writing nothing', () => {
  const r = run('add', 'models/R.step', '--ref', 'SW1', '--write')
  assert.equal(r.code, 1, r.out)
  assert.match(r.err, /SW1 is on 2 boards, Base\/SW1 in base\.tsx, 10k and Sense\/SW1 in sense\.tsx, 22k: name one with --entry <board> or --ref <board>\/SW1/)
  assert.equal(read('base.tsx'), BASE)
  assert.equal(read('sense.tsx'), SENSE)
})

test('add --ref <board>/<ref> writes into that board only', () => {
  const r = run('add', 'models/R.step', '--ref', 'Sense/SW1', '--write')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /wrote sense\.tsx:4/)
  assert.match(read('sense.tsx'), /const SW1 = R0603\(\{ value: '22k', model: /)
  assert.equal(read('base.tsx'), BASE)
})

test('add --entry picks the board by entry file or board name; a ref on one board needs neither', () => {
  const r = run('add', 'models/R.step', '--ref', 'SW1', '--entry', 'base.tsx', '--write')
  assert.equal(r.code, 0, r.err)
  assert.match(read('base.tsx'), /const SW1 = R0603\(\{ value: '10k', model: /)
  const bad = run('add', 'models/R.step', '--ref', 'SW1', '--entry', 'Nowhere')
  assert.equal(bad.code, 1)
  assert.match(bad.err, /no board Nowhere; the boards: Base \(base\.tsx\), Sense \(sense\.tsx\)/)
  const one = run('add', 'models/R.step', '--ref', 'R3')
  assert.equal(one.code, 0, one.err)
  assert.match(one.out, /paste it into the options of R3 at sense\.tsx:6/)
})

test('align refuses a bare ref on two boards and takes <board>/<ref>, --entry or the entry argument', () => {
  const r = run('align', 'R1')
  assert.equal(r.code, 1)
  assert.match(r.err, /R1 is on 2 boards/)
  for (const args of [['Sense/SW1'], ['--entry', 'Sense', 'SW1'], ['sense.tsx', 'SW1']]) {
    const a = run('align', ...args)
    assert.equal(a.code, 0, `${args.join(' ')}: ${a.err}`)
    assert.match(a.out, /^SW1\s+models\/R\.step/m)
  }
})

test('check names the board in the fix of a flagged part', () => {
  const r = run('check')
  assert.equal(r.code, 1)
  assert.match(r.out, /fix: pcbjs model add <file-or-url> --ref Sense\/R3 --write/)
})

test('findFootprint and boardMatches on their own', () => {
  const fp = (ref, value) => ({ ref, value, id: 'x' })
  const c = (name, rel, refs) => ({ board: { name, footprints: refs.map(r => fp(r, name)) }, entry: { rel }, site: { footprints: refs.map(ref => ({ ref })) } })
  const p = { compiled: [c('Base', 'Base/pcb.tsx', ['SW1', 'R1']), c('Sense', 'Sense/pcb.tsx', ['SW1', 'U1'])] }
  assert.throws(() => findFootprint(p, 'SW1'), /SW1 is on 2 boards/)
  assert.equal(findFootprint(p, 'SW1', undefined, 'Sense').c.board.name, 'Sense')
  assert.equal(findFootprint(p, 'Sense/SW1').c.board.name, 'Sense')
  assert.equal(findFootprint(p, 'U1').c.board.name, 'Sense')
  assert.equal(findFootprint(p, 'Base/U1'), null)
  for (const n of ['Base', 'base', 'Base/pcb.tsx', './Base/pcb.tsx', 'Base/']) assert.ok(boardMatches(p.compiled[0], n), n)
  assert.ok(!boardMatches(p.compiled[0], 'Sense'))
  assert.deepEqual(splitRef('Sense/SW1'), { board: 'Sense', ref: 'SW1' })
  assert.deepEqual(splitRef('SW1'), { ref: 'SW1' })
})
