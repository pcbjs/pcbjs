// `pcbjs shot` exits as soon as its files are written, with no esbuild service left keeping the process up.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChrome } from '../dist/shot.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const EXIT_MS = 2000

const BOARD = `import PCB from '@pcbjs/core'

export default (
  <PCB name="Exit">
    <path layer="Edge.Cuts" d="M 0 0 H 20 V 10 H 0 Z" />
    <footprint ref="TP1" value="V" id="pcbjs:TestPad" at="5 5" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>
  </PCB>
)
`

let root

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-shot-exit-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['main.tsx'] })\n")
  writeFileSync(join(root, 'main.tsx'), BOARD)
})

after(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

test('pcbjs shot --view 3d exits within 2 s of writing its PNG', { skip: !findChrome() && 'no Chrome', timeout: 120000 }, async () => {
  const child = spawn(process.execPath, [BIN, 'shot', '--view', '3d', '--fresh', '-p', '0'], {
    cwd: root,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let written = 0
  const png = join(root, '.pcbjs', 'shots', 'Exit-3d.png')
  child.stdout.on('data', d => {
    out += d
    if (!written && existsSync(png)) written = Date.now()
  })
  child.stderr.on('data', d => {
    out += d
  })
  const exited = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })))
  const kill = setTimeout(() => child.kill('SIGKILL'), 100000)
  const res = await exited
  clearTimeout(kill)
  assert.ok(written, `no PNG:\n${out}`)
  assert.equal(res.code, 0, out)
  const ms = Date.now() - written
  assert.ok(ms < EXIT_MS, `exited ${ms} ms after the PNG was written:\n${out}`)
})
