// Closing a dev server during its first compile: the process exits by itself, with no esbuild service left behind.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const SERVER = join(REPO, 'packages', 'cli', 'dist', 'server.js')
const PORT = 5265
const EXIT_MS = 5000

const BOARD = `import PCB from '@pcbjs/core'

export default (
  <PCB name="Close">
    <path layer="Edge.Cuts" d="M 0 0 H 20 V 10 H 0 Z" />
    <footprint ref="TP1" value="V" id="pcbjs:TestPad" at="5 5" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>
  </PCB>
)
`

let root, wss
const frames = []

before(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-close-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['main.tsx'], vite: { logLevel: 'silent' } })\n")
  writeFileSync(join(root, 'main.tsx'), BOARD)
  wss = new WebSocketServer({ host: '127.0.0.1', port: PORT })
  await new Promise(r => wss.once('listening', r))
  wss.on('connection', (ws, req) => ws.on('message', raw => frames.push({ path: req.url, ...JSON.parse(String(raw)) })))
})

after(async () => {
  for (const ws of wss?.clients ?? []) ws.terminate()
  await new Promise(r => (wss ? wss.close(() => r()) : r()))
  if (root) rmSync(root, { recursive: true, force: true })
})

const until = async (pred, ms = 30000) => {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 10))
  }
}

function start(args, token) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', d => {
    out += d
  })
  child.stderr.on('data', d => {
    out += d
  })
  const exited = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })))
  const ready = () => frames.find(f => f.path === `/${token}` && f.event === 'pcbjs:ide:ready')
  const boards = () => frames.some(f => f.path === `/${token}` && f.event === 'pcbjs:ide:boards')
  return { child, exited, ready, boards, out: () => out }
}

async function exitsWithin(run, ms) {
  const timer = setTimeout(() => run.child.kill('SIGKILL'), ms)
  const t = Date.now()
  const res = await run.exited
  clearTimeout(timer)
  assert.ok(res.signal !== 'SIGKILL', `still running ${ms} ms after close:\n${run.out()}`)
  return { ...res, ms: Date.now() - t }
}

test('pcbjs dev --ide closed by a signal during its first compile exits and removes dev.json', async () => {
  const run = start([BIN, 'dev', `--ide=ws://127.0.0.1:${PORT}/signal`, '--port', '0', '--host', '127.0.0.1'], 'signal')
  await until(run.ready)
  assert.ok(!run.boards(), 'closed before the first compile ended')
  run.child.kill('SIGTERM')
  await exitsWithin(run, EXIT_MS)
  assert.ok(!existsSync(join(root, '.pcbjs', 'dev.json')))
})

test('the dev server of --ide closed during its first compile lets its process exit, esbuild stopped', async () => {
  const script = `
    import { dev } from ${JSON.stringify(SERVER)}
    const server = await dev({ root: ${JSON.stringify(root)}, port: 0, host: '127.0.0.1', ide: 'ws://127.0.0.1:${PORT}/close' })
    await server.close()
    console.log('closed')
  `
  const run = start(['--input-type=module', '-e', script], 'close')
  await until(() => /closed/.test(run.out()) || run.child.exitCode !== null).catch(() => run.child.kill('SIGKILL'))
  assert.ok(run.ready(), run.out())
  const res = await exitsWithin(run, EXIT_MS)
  assert.equal(res.code, 0, run.out())
})
