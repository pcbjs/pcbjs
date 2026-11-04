// The language server loads only when an editor asks for it: check, build and a plain dev server, a bridge and a viewer
// included, never resolve @pcbjs/lsp; the first LSP initialize does. Proven through the module loader's resolve hook.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { board } from './fixtures/workspace.mjs'
import { printedPort, stop } from './fixtures/proc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const HOOK = pathToFileURL(join(REPO, 'packages', 'cli', 'tests', 'fixtures', 'trace-lsp.mjs')).href
let PORT

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

test('the session loads it on the first LSP initialize, not before', async () => {
  const child = spawn(process.execPath, ['--import', HOOK, BIN, 'session', 'serve', '-p', '0', '--host', '127.0.0.1'], {
    cwd: root,
    env: env('dev'),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    let out = ''
    child.stdout.on('data', d => {
      out += d
    })
    child.stderr.on('data', d => {
      out += d
    })
    PORT = await printedPort(() => out)
    // a viewer page, a compiled board, a session connection with hello and a session request: still nothing
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/__pcbjs/Lazy/board.json`)).status, 200)
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/__pcbjs/session`)
    await new Promise((ok, fail) => {
      ws.once('open', ok)
      ws.once('error', fail)
    })
    const frames = []
    ws.on('message', raw => frames.push(JSON.parse(raw.toString())))
    const next = async pred => {
      for (let i = 0; i < 600; i++) {
        const m = frames.find(pred)
        if (m) return m
        await new Promise(r => setTimeout(r, 50))
      }
      throw new Error('no such frame')
    }
    ws.send(JSON.stringify({ event: 'pcbjs:ide:hello', data: { name: 'test', version: '0', protocol: 2, major: 1, capabilities: [] } }))
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'session/clients' }))
    await next(m => m.event === 'pcbjs:ide:ready')
    await next(m => m.id === 9)
    assert.equal(loaded('dev'), '')
    // the editor asks for the language server
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } }))
    const res = await next(m => m.id === 1)
    assert.equal(res.result.serverInfo.name, 'pcbjs')
    assert.match(loaded('dev'), /@pcbjs\/lsp/)
    ws.close()
  } finally {
    await stop(child)
  }
})
