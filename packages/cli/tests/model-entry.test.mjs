// `pcbjs model` in a project of two boards that share a ref: add and align refuse a bare ref on both and list the boards,
// `--entry` picks one and --write edits that board's code only, and check's fixes name the board.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const SENSE = board('Sense', '22k', "\nconst R3 = R0603('2k', { model: { file: './models/nowhere.step' } })")

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-model-entry-')))
mkdirSync(join(root, 'node_modules'))
mkdirSync(join(root, 'models'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
writeFileSync(
  join(root, 'pcb.config.ts'),
  "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['base.tsx', 'sense.tsx'], vite: { logLevel: 'silent' } })\n",
)
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
  assert.match(r.err, /SW1 is on 2 boards, Base in base\.tsx, 10k and Sense in sense\.tsx, 22k: name the board/)
  assert.equal(read('base.tsx'), BASE)
  assert.equal(read('sense.tsx'), SENSE)
})

test('add --ref with --entry writes into that board only', () => {
  const r = run('add', 'models/R.step', '--ref', 'SW1', '--entry', 'Sense', '--write')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /wrote sense\.tsx:4/)
  assert.match(read('sense.tsx'), /const SW1 = R0603\('22k', \{ model: /)
  assert.equal(read('base.tsx'), BASE)
})
