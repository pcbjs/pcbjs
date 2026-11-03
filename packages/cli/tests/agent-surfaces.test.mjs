// The agent surfaces over a real session: `pcbjs mcp` lists its tools, runs check, query and render, records the harness and its task,
// updates a subscribed findings resource after an edit and hands over a human's message; `pcbjs lsp --stdio` pushes diagnostics after an
// edit; the hooks claim a write for the agent and bring the events and messages of the turn.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { board } from './fixtures/workspace.mjs'
import { stop } from './fixtures/proc.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

const dirs = []
const children = []
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function project(name) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-surfaces-')))
  dirs.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'pcb.tsx'), board(name))
  return root
}

const moved = (name, x = '25mm') => board(name).replace('15mm 10mm', `${x} 10mm`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function until(fn, ms = 60000) {
  const t0 = Date.now()
  let v
  while (!(v = await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await sleep(50)
  }
  return v
}

async function serve(root) {
  const child = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  await until(() => /\[pcbjs\] session \w+, pid/.test(out))
  return { info: JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8')), stop: () => stop(child) }
}

/** A WebSocket client of the session, as the editor or a watcher. */
async function client(info, role, project) {
  const ws = new WebSocket(`ws://127.0.0.1:${new URL(info.url).port}/__pcbjs/session`)
  await new Promise((ok, fail) => {
    ws.once('open', ok)
    ws.once('error', fail)
  })
  const frames = []
  const waits = new Map()
  let id = 0
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString())
    frames.push(m)
    if (m.jsonrpc && waits.has(m.id) && !m.method) {
      const w = waits.get(m.id)
      waits.delete(m.id)
      m.error ? w.fail(new Error(m.error.message)) : w.ok(m.result)
    }
  })
  ws.send(JSON.stringify({ event: 'pcbjs:ide:hello', data: { name: `test ${role}`, version: '0', protocol: 2, major: 1, capabilities: [], role, project } }))
  await until(() => frames.some(m => m.event === 'pcbjs:ide:ready'))
  return {
    events: () => frames.filter(f => f.event === 'session/event').map(f => f.data),
    request: (method, params = {}) =>
      new Promise((ok, fail) => {
        waits.set(++id, { ok, fail })
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      }),
    close: () => ws.close(),
  }
}

/** `pcbjs mcp` on stdio: requests, and every notification it sent. */
function mcpClient(root) {
  const p = spawn(process.execPath, [BIN, 'mcp'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(p)
  const notes = []
  const waits = new Map()
  let buf = '',
    err = '',
    id = 0
  p.stderr.on('data', d => (err += d))
  p.stdout.on('data', d => {
    buf += d
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const m = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      if (m.id !== undefined && waits.has(m.id)) {
        waits.get(m.id)(m)
        waits.delete(m.id)
      } else notes.push(m)
    }
  })
  const request = (method, params = {}) =>
    new Promise((ok, fail) => {
      waits.set(++id, m => (m.error ? fail(new Error(`${m.error.message}\n${err}`)) : ok(m.result)))
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  return { notes, request, call: (name, args = {}) => request('tools/call', { name, arguments: args }), end: () => p.stdin.end(), exited: new Promise(r => p.once('exit', r)) }
}

const textOf = r =>
  r.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')

test(
  'mcp: tools, check, query, render, describe in session/clients, a findings subscription updated by an edit, a message at the top of the next result',
  { timeout: 240000 },
  async () => {
    const root = project('Mcp')
    const s = await serve(root)
    const m = mcpClient(root)
    try {
      const init = await m.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-harness', version: '1' } })
      assert.equal(init.serverInfo.name, 'pcbjs')
      assert.ok(init.capabilities.resources.subscribe)
      assert.match(init.instructions, /session with your task and a plan/)
      const { tools } = await m.request('tools/list')
      assert.deepEqual(
        tools.map(t => t.name),
        ['check', 'inspect', 'query', 'render', 'script', 'docs', 'read', 'write', 'events', 'session'],
      )
      const said = await m.call('session', { task: 'move TP2 out', plan: ['move TP2', 'check'] })
      assert.ok(!said.isError, textOf(said))
      const editor = await client(s.info, 'editor', root)
      const clients = await editor.request('session/clients')
      const me = clients.find(c => c.name === 'test-harness')
      assert.deepEqual([me.role, me.task, me.plan, me.root], ['agent', 'move TP2 out', ['move TP2', 'check'], root])

      const checked = await m.call('check')
      assert.match(textOf(checked), /Mcp/)
      assert.match(textOf(checked), /exit [01]; snapshot \w+\.\d+/)
      const q = JSON.parse(textOf(await m.call('query', { reference: 'TP1' })))
      assert.equal(q.value.record.ref, 'TP1')
      const shot = await m.call('render', { view: '2d', size: [320, 240] })
      assert.equal(shot.content[0].type, 'image')
      assert.equal(shot.content[0].mimeType, 'image/png')
      assert.match(shot.content[1].text, /^Mcp 2d/)

      const uri = 'pcbjs://Mcp/findings'
      const listed = await m.request('resources/list')
      assert.ok(listed.resources.some(r => r.uri === uri))
      await m.request('resources/subscribe', { uri })
      const wrote = await m.call('write', { file: 'pcb.tsx', edits: [{ old: '15mm 10mm', new: '25mm 10mm' }] })
      assert.match(textOf(wrote), /wrote .*pcb\.tsx via disk/)
      await until(() => m.notes.find(n => n.method === 'notifications/resources/updated' && n.params.uri === uri), 120000)

      const sent = await editor.request('session/send', { to: me.client, comment: 'look at TP2', refs: ['TP2'], board: 'Mcp' })
      await until(() => m.notes.find(n => n.method === 'notifications/message' && /look at TP2/.test(n.params.data)))
      const next = await m.call('docs', { grep: 'skills install' })
      assert.match(next.content[0].text, new RegExp(`^pcbjs message ${sent.id.replace('.', '\\.')} from test editor: look at TP2\\n  refs: TP2`))
      const log = await editor.request('session/events', { since: `${s.info.session}.0`, kind: ['edit', 'delivered'] })
      const edit = log.events.find(e => e.kind === 'edit')
      assert.deepEqual([edit.data.source, edit.by.name, edit.by.role, edit.by.task], ['agent', 'test-harness', 'agent', 'move TP2 out'])
      assert.ok(log.events.some(e => e.kind === 'delivered' && e.data.message === sent.id && !e.data.returned))
      editor.close()
    } finally {
      m.end()
      await m.exited
      await s.stop()
    }
  },
)

/** `pcbjs lsp --stdio`: LSP framing both ways, and every notification it sent. */
function lspClient(root, ...args) {
  const p = spawn(process.execPath, [BIN, 'lsp', '--stdio', ...args], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(p)
  const notes = []
  const waits = new Map()
  let buf = Buffer.alloc(0),
    id = 0
  p.stdout.on('data', d => {
    buf = Buffer.concat([buf, d])
    for (;;) {
      const end = buf.indexOf('\r\n\r\n')
      if (end < 0) return
      const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, end).toString())[1])
      if (buf.length < end + 4 + len) return
      const m = JSON.parse(buf.subarray(end + 4, end + 4 + len).toString())
      buf = buf.subarray(end + 4 + len)
      if (m.id !== undefined && !m.method && waits.has(m.id)) {
        waits.get(m.id)(m)
        waits.delete(m.id)
      } else if (m.method && m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: null })
      else notes.push(m)
    }
  })
  const send = m => {
    const body = Buffer.from(JSON.stringify(m))
    p.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
  }
  return {
    notes,
    send,
    request: (method, params) =>
      new Promise(ok => {
        waits.set(++id, ok)
        send({ jsonrpc: '2.0', id, method, params })
      }),
    end: () => p.stdin.end(),
    exited: new Promise(r => p.once('exit', r)),
  }
}

test('lsp --stdio: starts a session when none is live, and pushes the diagnostics after an edit', { timeout: 180000 }, async () => {
  const root = project('Lsp')
  const l = lspClient(root)
  try {
    const init = await l.request('initialize', { processId: null, rootUri: pathToFileURL(root).href, capabilities: {}, clientInfo: { name: 'test-nvim' } })
    assert.ok(init.result.capabilities.hoverProvider)
    l.send({ jsonrpc: '2.0', method: 'initialized', params: {} })
    const uri = pathToFileURL(join(root, 'pcb.tsx')).href
    const diags = () => l.notes.filter(n => n.method === 'textDocument/publishDiagnostics' && n.params.uri === uri)
    l.send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescriptreact', version: 1, text: board('Lsp') } } })
    await until(() => diags().length)
    const before = diags().length
    l.send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: moved('Lsp') }] } })
    await until(
      () =>
        diags()
          .slice(before)
          .some(d => d.params.diagnostics.some(x => /^pcbjs (DRC|ERC)/.test(x.source))),
      120000,
    ).catch(e => {
      throw new Error(`${e.message}: ${JSON.stringify(diags().map(d => d.params.diagnostics))}`)
    })
    const info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8'))
    assert.match(info.session, /^[a-z2-7]{8}$/, 'it started a session')
  } finally {
    l.end()
    await l.exited
    spawnSync(process.execPath, [BIN, 'session', 'stop'], { cwd: root, timeout: 30000 })
  }
})

const hook = (root, action, input, ...args) =>
  spawnSync(process.execPath, [BIN, 'hook', action, ...args], { cwd: root, input: JSON.stringify(input), encoding: 'utf8', timeout: 60000 })

test('hooks: skills install writes them; edited claims a write as the agent, prompt brings the turn’s events and the waiting messages', { timeout: 240000 }, async () => {
  const root = project('Hooks')
  mkdirSync(join(root, '.vscode'))
  const installed = spawnSync(process.execPath, [BIN, 'skills', 'install'], { cwd: root, encoding: 'utf8', timeout: 60000 })
  assert.equal(installed.status, 0, installed.stderr)
  const json = f => JSON.parse(readFileSync(join(root, f), 'utf8'))
  assert.deepEqual(json('.mcp.json').mcpServers.pcbjs, { command: 'npx', args: ['--no-install', 'pcbjs', 'mcp'] })
  assert.equal(json('.vscode/mcp.json').servers.pcbjs.type, 'stdio')
  assert.deepEqual(json('.claude/plugins/pcbjs/.lsp.json').pcbjs.args, ['--no-install', 'pcbjs', 'lsp', '--stdio', '--agent'])
  const hooks = json('.claude/plugins/pcbjs/hooks/hooks.json').hooks
  assert.match(hooks.UserPromptSubmit[0].hooks[0].command, /pcbjs hook prompt$/)
  assert.equal(hooks.PostToolUse[0].matcher, 'Edit|Write|MultiEdit')
  assert.match(hooks.PostToolUse[0].hooks[0].command, /pcbjs hook edited$/)
  assert.equal(json('.claude/settings.json').enabledPlugins['pcbjs@pcbjs-project'], true)
  assert.equal(json('.claude-plugin/marketplace.json').plugins[0].source, './.claude/plugins/pcbjs')
  const bare = project('NoHooks')
  assert.equal(spawnSync(process.execPath, [BIN, 'skills', 'install', '--no-hooks', '--mcp', 'codex'], { cwd: bare, encoding: 'utf8' }).status, 0)
  assert.throws(() => readFileSync(join(bare, '.claude/plugins/pcbjs/hooks/hooks.json')))
  assert.match(readFileSync(join(bare, '.codex/config.toml'), 'utf8'), /\[mcp_servers\.pcbjs\]\ncommand = "npx"/)

  assert.equal(hook(root, 'edited', { cwd: root, tool_input: { file_path: join(root, 'pcb.tsx') } }).status, 0, 'no session: silent')
  const s = await serve(root)
  const m = mcpClient(root)
  try {
    await m.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2' } })
    await m.call('session', { task: 'claimed edits' })
    const watch = await client(s.info, 'cli', root)
    await watch.request('session/events', { follow: true, kind: ['edit'] })
    const first = hook(root, 'prompt', { cwd: root, session_id: 'abc' })
    assert.equal(first.status, 0, first.stderr)
    writeFileSync(join(root, 'pcb.tsx'), moved('Hooks'))
    const claim = hook(root, 'edited', { cwd: root, tool_name: 'Write', tool_input: { file_path: join(root, 'pcb.tsx') } })
    assert.deepEqual([claim.status, claim.stderr], [0, ''])
    const edit = await until(() => watch.events().find(e => e.kind === 'edit'))
    assert.deepEqual([edit.data.source, edit.by?.name, edit.by?.role, edit.by?.task], ['agent', 'claude-code', 'agent', 'claimed edits'], JSON.stringify(watch.events()))
    const clients = await watch.request('session/clients')
    const agent = clients.find(c => c.name === 'claude-code')
    await watch.request('session/send', { to: agent.client, comment: 'and TP1 too' })
    const turn = hook(root, 'prompt', { cwd: root, session_id: 'abc' })
    assert.equal(turn.status, 0, turn.stderr)
    assert.match(turn.stdout, /pcbjs since your last turn:\n {2}edit pcb\.tsx by claude-code \(agent\)/)
    assert.match(turn.stdout, /pcbjs message \S+ from test cli: and TP1 too/)
    assert.doesNotMatch(hook(root, 'prompt', { cwd: root, session_id: 'abc' }).stdout, /and TP1 too/, 'a message goes once')
    watch.close()
  } finally {
    m.end()
    await m.exited
    await s.stop()
  }
})
