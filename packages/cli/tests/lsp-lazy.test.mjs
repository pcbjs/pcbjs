// The language server loads only when an editor asks for it: check, build and a plain dev server, a bridge and a viewer
// included, never resolve @pcbjs/lsp; the first LSP initialize does. Proven through the module loader's resolve hook.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { board } from './fixtures/workspace.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const HOOK = join(REPO, 'packages', 'cli', 'tests', 'fixtures', 'trace-lsp.mjs')
const PORT = 5272

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-lazy-')))
mkdirSync(join(root, 'node_modules'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
writeFileSync(join(root, 'pcb.tsx'), board('Lazy'))
after(() => rmSync(root, { recursive: true, force: true }))

const trace = name => join(root, `trace-${name}.txt`)
const loaded = name => (existsSync(trace(name)) ? readFileSync(trace(name), 'utf8') : '')
const env = name => ({ ...process.env, PCBJS_TRACE: trace(name), NO_COLOR: '1' })

test('the hook sees a dynamic import of @pcbjs/lsp', () => {
  execFileSync(process.execPath, ['--import', HOOK, '--input-type=module', '-e', "await import('@pcbjs/lsp')"], { cwd: root, env: env('probe') })
  assert.match(loaded('probe'), /@pcbjs\/lsp/)
})

test('pcbjs check never loads the language server', () => {
  execFileSync(process.execPath, ['--import', HOOK, BIN, 'check'], { cwd: root, env: env('check'), stdio: 'pipe' })
  assert.equal(loaded('check'), '')
})

test('pcbjs build never loads the language server', () => {
  execFileSync(process.execPath, ['--import', HOOK, BIN, 'build', '-q'], { cwd: root, env: env('build'), stdio: 'pipe' })
  assert.ok(existsSync(join(root, '.pcbjs')))
  assert.equal(loaded('build'), '')
})

test('pcbjs dev loads it on the first LSP initialize, not before', async () => {
  const child = spawn(process.execPath, ['--import', HOOK, BIN, 'dev', '-p', String(PORT), '--host', '127.0.0.1'], { cwd: root, env: env('dev'), stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const t0 = Date.now()
    while (!/127\.0\.0\.1:5272/.test(out)) {
      if (Date.now() - t0 > 30000) throw new Error(`dev did not start:\n${out}`)
      await new Promise(r => setTimeout(r, 50))
    }
    // a viewer page, a compiled board, a bridge with cursor and focus: still nothing
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/__pcbjs/Lazy/board.json`)).status, 200)
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`, 'vite-hmr')
    await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail) })
    const send = (event, data) => ws.send(JSON.stringify({ type: 'custom', event, data }))
    send('pcbjs:ide:hello', { name: 'test', version: '0' })
    send('pcbjs:ide:focus', { file: join(root, 'pcb.tsx') })
    send('pcbjs:ide:cursor', { file: join(root, 'pcb.tsx'), line: 5, col: 5 })
    await new Promise(r => setTimeout(r, 300))
    assert.equal(loaded('dev'), '')
    // the editor asks for the language server
    const answer = new Promise(ok => ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.event === 'pcbjs:lsp' && m.data?.id === 1) ok(m.data) }))
    send('pcbjs:lsp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } })
    const res = await answer
    assert.equal(res.result.serverInfo.name, 'pcbjs')
    assert.match(loaded('dev'), /@pcbjs\/lsp/)
    ws.close()
  } finally {
    child.kill('SIGTERM')
    await new Promise(r => child.once('exit', r))
  }
})
