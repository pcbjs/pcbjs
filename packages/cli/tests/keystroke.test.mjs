// Typing after the initial editor diagnostics, through a real session and a fake editor: ten characters into Blinky's <text> label 50 ms apart each get the keystroke tier's
// facet of the text, the median within 100 ms and every one within 300 ms, no facet of a run an edit made stale reaches the viewer, one full compile runs after the burst,
// and the keystroke tier leaves the stage cache as it was.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { stop } from './fixtures/proc.mjs'
import { viewerClient } from './fixtures/viewer.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const LABEL = 'Blinky · pcbjs'
const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function blinky() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-keys-')))
  dirs.push(root)
  cpSync(join(REPO, 'examples', 'demo'), root, { recursive: true, filter: s => !/[\\/](?:\.pcbjs|node_modules)$/.test(s) })
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  const cfg = join(root, 'pcb.config.ts')
  writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(/entries:\s*\[[^\]]*\]/, "entries: ['blinky.pcb.tsx']"))
  return root
}

async function until(fn, ms = 60000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 20))
  }
}

async function serve(root) {
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  await until(() => /\[pcbjs\] session \w+, pid/.test(out))
  return { info: JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8')), log: () => out, stop: () => stop(child) }
}

const open = async url => {
  const ws = new WebSocket(...url)
  await new Promise((ok, fail) => (ws.once('open', ok), ws.once('error', fail)))
  return ws
}

/** A 2D page of the session: every event with the time it came. */
async function viewer(port) {
  const v = await viewerClient(port)
  const got = []
  v.on((event, data) => got.push({ at: performance.now(), event, ...data }))
  await v.observe('Blinky')
  return { got, close: v.close }
}

/** An editor on the session's socket with the file open and its cursor in it. */
async function editor(port, root, file, text) {
  const ws = await open([`ws://127.0.0.1:${port}/__pcbjs/session`])
  const frames = []
  const waits = new Map()
  let id = 0
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    frames.push(m)
    if (m.jsonrpc && m.id !== undefined && waits.has(m.id) && !m.method) {
      const w = waits.get(m.id)
      waits.delete(m.id)
      m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result)
    }
  })
  const send = m => ws.send(JSON.stringify(m))
  const request = (method, params = {}) =>
    new Promise((ok, fail) => {
      waits.set(++id, { ok, fail })
      send({ jsonrpc: '2.0', id, method, params })
    })
  const notify = (method, params) => send({ jsonrpc: '2.0', method, params })
  const uri = pathToFileURL(file).href
  let version = 1
  send({ event: 'pcbjs:ide:hello', data: { name: 'test editor', version: '0', protocol: 2, major: 1, capabilities: [], role: 'editor', project: root } })
  await until(() => frames.some(m => m.event === 'pcbjs:ide:ready'))
  await request('initialize', { processId: null, rootUri: pathToFileURL(root).href, capabilities: {} })
  notify('initialized', {})
  notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version, text } })
  return {
    frames,
    request,
    type(next, line, character) {
      notify('textDocument/didChange', { textDocument: { uri, version: ++version }, contentChanges: [{ text: next }] })
      notify('pcbjs/focus', { textDocument: { uri }, position: { line: line - 1, character } })
    },
    close: () => ws.close(),
  }
}

/** Every file under the stage cache with its size and mtime. */
function cacheState(root) {
  const dir = join(root, '.pcbjs', 'cache')
  const out = []
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (!p.includes(`${join('cache', 'vite')}`)) out.push(`${p.slice(dir.length)} ${statSync(p).size} ${statSync(p).mtimeMs}`)
    }
  }
  walk(dir)
  return out.sort()
}

test('typing in a text block: the keystroke tier per key, nothing stale, one full compile after the burst', { timeout: 180000 }, async t => {
  const root = blinky()
  const file = join(root, 'blinky.pcb.tsx')
  const text = readFileSync(file, 'utf8')
  const s = await serve(root)
  try {
    assert.deepEqual(s.info.tiers, { keystroke: 30, quiet: 300 })
    const port = new URL(s.info.url).port
    const view = await viewer(port)
    const ed = await editor(port, root, file, text)
    await ed.request('session/check')
    const ready = performance.now()
    await until(() => ed.frames.some(m => m.method === 'textDocument/publishDiagnostics' && m.params.uri === pathToFileURL(file).href))
    t.diagnostic(`initial editor diagnostics ready after ${(performance.now() - ready).toFixed(0)} ms`)
    await until(() => view.got.some(m => m.event === 'pcbjs:status' && m.phase === 'idle'))
    let since = (await ed.request('session/events', {})).next
    const cache = cacheState(root)
    const lines = text.split('\n')
    const line = lines.findIndex(l => l.includes(LABEL)) + 1
    const from = view.got.length
    const sent = []
    let now = text
    for (let i = 1; i <= 10; i++) {
      now = now.replace(LABEL + 'x'.repeat(i - 1), LABEL + 'x'.repeat(i))
      sent.push(performance.now())
      ed.type(now, line, lines[line - 1].length + i)
      await new Promise(r => setTimeout(r, 50))
    }
    const burst = view.got.length
    // the keystroke tier never writes the stage cache
    assert.deepEqual(cacheState(root), cache)
    await until(() => view.got.slice(burst).some(m => m.event === 'pcbjs:status' && m.phase === 'idle'), 30000)
    const got = view.got.slice(from)
    const sketches = got.filter(m => m.event === 'pcbjs:facet' && m.partial)
    // the first sketch of this keystroke or a later one: newer than the edit of the first invalidate after it
    const latency = sent.map(t => {
      const inv = got.find(m => m.event === 'pcbjs:invalidate' && m.at > t)
      const f = inv && sketches.find(m => m.run > (inv.edit ?? -1))
      return f ? f.at - t : Infinity
    })
    t.diagnostic(`keystroke to first facet, ms: ${latency.map(Math.round).join(' ')}`)
    const median = [...latency].sort((x, y) => x - y)[latency.length >> 1]
    assert.ok(median < 100, `median keystroke to first facet ${median.toFixed(0)} ms, ${JSON.stringify(latency.map(Math.round))}`)
    for (const [i, ms] of latency.entries()) assert.ok(ms < 300, `keystroke ${i + 1}: first facet ${ms.toFixed(0)} ms after it, ${JSON.stringify(latency.map(Math.round))}`)
    // each sketch draws the text alone, as typed
    for (const m of sketches) {
      assert.ok(m.data.items.length > 0 && m.data.items.every(it => it.kind === 'text'), JSON.stringify(m.data.items.map(it => it.kind)))
      assert.ok(m.partial.replaces.length > 0)
    }
    // no facet of a run an edit already made stale
    let edit = -1
    for (const m of got) {
      if (m.event === 'pcbjs:invalidate' && m.edit) edit = Math.max(edit, m.edit)
      if (m.event === 'pcbjs:facet') assert.ok(m.run > edit, `a facet of run ${m.run} after the edit of ${edit}: ${m.facet}@${m.stage}`)
    }
    // one full compile after the burst, of the text as last typed
    const events = (await ed.request('session/events', { since })).events
    const compiles = new Set(events.filter(e => e.kind === 'compile' && 'stage' in e.data).map(e => e.data.snapshot))
    assert.equal(compiles.size, 1, JSON.stringify([...compiles]))
    const full = got.filter(m => m.event === 'pcbjs:facet' && !m.partial)
    assert.ok(full.length > 0 && full.every(m => m.at > sent.at(-1) + 300), 'the full tier waits for the quiet period')
    view.close()
    ed.close()
  } finally {
    if (process.env.PCBJS_DEBUG_SKETCH)
      t.diagnostic(
        s
          .log()
          .split('\n')
          .filter(line => line.includes('sketch '))
          .join('\n'),
      )
    await s.stop()
  }
})
