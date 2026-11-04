// Closing a dev server during its first compile: the process exits by itself, with no esbuild service left behind.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connectSession } from '../dist/session/client.js'
import { stop } from './fixtures/proc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const SERVE = join(REPO, 'packages', 'cli', 'dist', 'session', 'serve.js')
const EXIT_MS = 5000

const BOARD = `import PCB, { defineFootprint, type FootprintProps } from '@pcbjs/core'

const TestPad = defineFootprint(function TestPad(props: FootprintProps) {
  return <footprint value="V" id="pcbjs:TestPad" bom={false} {...props}><pad num={1} size={2} shape="circle" /></footprint>
}, { pins: ['1'], prefix: 'TP' })
const TP1 = TestPad()

export default (
  <PCB name="Close">
    <path layer="Edge.Cuts" d="M 0 0 H 20 V 10 H 0 Z" />
    <TP1 at="5 5" />
  </PCB>
)
`

let root
const children = []

before(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-close-')))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['main.tsx'], vite: { logLevel: 'silent' } })\n")
  writeFileSync(join(root, 'main.tsx'), BOARD)
})

after(async () => {
  for (const child of children) await stop(child)
  if (root) rmSync(root, { recursive: true, force: true })
})

const until = async (pred, ms = 30000) => {
  const end = Date.now() + ms
  while (!(await pred())) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 10))
  }
}

function start(args) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => {
    out += d
  })
  child.stderr.on('data', d => {
    out += d
  })
  const exited = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })))
  return { child, exited, out: () => out }
}

async function exitsWithin(run, ms) {
  const timer = setTimeout(() => run.child.kill('SIGKILL'), ms)
  const t = Date.now()
  const res = await run.exited
  clearTimeout(timer)
  assert.ok(res.signal !== 'SIGKILL', `still running ${ms} ms after close:\n${run.out()}`)
  return { ...res, ms: Date.now() - t }
}

const devJson = () => join(root, '.pcbjs', 'dev.json')
const readInfo = () => {
  try {
    return JSON.parse(readFileSync(devJson(), 'utf8'))
  } catch {
    return null
  }
}

test(
  'pcbjs session serve with an editor attached, closed by a signal during its first compile, exits and removes dev.json',
  { skip: process.platform === 'win32' ? 'Windows SIGTERM is a forced kill; graceful stop is covered below' : false },
  async () => {
    const run = start([BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'])
    await until(() => readInfo()?.socket)
    const boards = []
    const editor = await connectSession(readInfo().socket, { name: 'editor', role: 'editor', capabilities: ['boards'] })
    editor.onEvent(e => e === 'pcbjs:ide:boards' && boards.push(e))
    assert.ok(!boards.length, 'closed before the first compile ended')
    run.child.kill('SIGTERM')
    await exitsWithin(run, EXIT_MS)
    await editor.done
    assert.ok(!existsSync(devJson()))
  },
)

test('a session stopped during its first compile lets its process exit, esbuild stopped', async () => {
  const script = `
    import { serveSession } from ${JSON.stringify(pathToFileURL(SERVE).href)}
    const session = await serveSession({ projects: [{ dir: ${JSON.stringify(root)} }], port: 0, host: '127.0.0.1', log: () => {} })
    console.log('listening')
    await new Promise(r => process.stdin.once('data', r))
    process.stdin.destroy()
    await session.stop('test')
    console.log('closed')
  `
  const run = start(['--input-type=module', '-e', script])
  await until(() => /listening/.test(run.out()) || run.child.exitCode !== null)
  assert.match(run.out(), /listening/)
  run.child.stdin.end('close\n')
  const res = await exitsWithin(run, EXIT_MS)
  assert.equal(res.code, 0, run.out())
  assert.match(run.out(), /closed/)
})
