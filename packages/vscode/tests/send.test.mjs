// Send to agent against the fake editor and a real session: greyed with no agent, sent at once to one, a quick pick with two that
// remembers the choice, the payload of an editor selection, a viewer selection and a finding, Read by once the MCP client's next tool
// result carried the message, and Returned when the agent left first.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMessageConnection } from 'vscode-jsonrpc'
import { until } from './fake.mjs'
import { commands, openDoc, ui, vscode } from './vscode.mjs'
import { board } from '../../cli/tests/fixtures/workspace.mjs'

const require = createRequire(import.meta.url)
const { PcbjsServer } = require('../dist/server.cjs')
const { PcbjsSession, transports, initializationOptions } = require('../dist/lsp-client.cjs')
const { AgentSender, PLACEHOLDER, AGENTS_KEY } = require('../dist/send.cjs')

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const BIN = path.join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8'))
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pcbjs-send-')))
const children = []
const pids = new Set()
after(() => {
  for (const c of children) c.kill('SIGKILL')
  for (const pid of pids)
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  rmSync(tmp, { recursive: true, force: true })
})

/** `pcbjs mcp` on stdio, initialized as the named harness. */
async function mcp(cwd, name) {
  const p = spawn(process.execPath, [BIN, 'mcp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(p)
  const waits = new Map()
  let buf = '',
    id = 0
  p.stdout.on('data', d => {
    buf += d
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const m = JSON.parse(buf.slice(0, i))
      buf = buf.slice(i + 1)
      if (m.id !== undefined && waits.has(m.id)) {
        waits.get(m.id)(m)
        waits.delete(m.id)
      }
    }
  })
  const request = (method, params = {}) =>
    new Promise((ok, fail) => {
      waits.set(++id, m => (m.error ? fail(new Error(m.error.message)) : ok(m.result)))
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } })
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const exited = new Promise(r => p.once('exit', r))
  return { call: (tool, args = {}) => request('tools/call', { name: tool, arguments: args }), end: () => (p.stdin.end(), exited) }
}

const textOf = r =>
  r.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')
const calls = kind => ui.calls.filter(c => c.kind === kind)
const status = () => calls('status').map(c => c.text)
const contextKey = () => commands.filter(c => c[0] === 'setContext' && c[1] === AGENTS_KEY).map(c => c[2])

test('the command is contributed greyed without an agent, in the editor, Boards and Findings context menus', () => {
  const cmd = pkg.contributes.commands.find(c => c.command === 'pcbjs.sendToAgent')
  assert.deepEqual([cmd.title, cmd.icon, cmd.enablement], ['Send to agent…', '$(agent)', 'pcbjs.agents'])
  const menus = pkg.contributes.menus
  assert.ok(menus['editor/context'].some(m => m.command === 'pcbjs.sendToAgent'))
  const items = menus['view/item/context'].filter(m => m.command === 'pcbjs.sendToAgent').map(m => m.when)
  assert.ok(items.some(w => w.includes('view == pcbjs.boards') && w.includes('ref')))
  assert.ok(items.some(w => w.includes('view == pcbjs.findings') && w.includes('finding')))
})

test('send to agent through a real session: none, one, two, the payloads, Read by and Returned', { timeout: 240000 }, async () => {
  const root = path.join(tmp, 'p')
  mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  symlinkSync(path.join(REPO, 'node_modules', '@pcbjs'), path.join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(
    path.join(root, 'pcb.config.ts'),
    "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n",
  )
  const text = board('Main')
  const file = path.join(root, 'pcb.tsx')
  writeFileSync(file, text)

  const held = new Map()
  let sender
  const server = new PcbjsServer({
    folders: () => [root],
    name: 'vscode-pcbjs',
    version: '0.3.0',
    nodePath: () => process.execPath,
    onEvent: (_l, e, d) => {
      if (e !== 'session/event' || !d?.id) return
      if (d.kind === 'selection') held.set(d.data.board, d.data.refs)
      else sender?.event(d)
    },
    readyTimeoutMs: 120000,
  })
  let memory
  sender = new AgentSender({
    request: (m, p) => server.request(m, p),
    board: () => 'Main',
    selection: b => held.get(b),
    memory: { get: () => memory, set: v => (memory = v) },
  })
  const agents = []
  try {
    await server.start()
    await server.whenReady()
    pids.add(server.pid)
    await until(() => server.boards?.boards.some(b => b.name === 'Main'), 60000)
    const link = server.client
    await link.request('session/events', { follow: true, kind: ['findings', 'selection', 'message', 'delivered'] })
    const messages = async () => (await link.request('session/events', { since: `${server.session}.0`, kind: ['message'] })).events

    // no agent: the key is false and the command says so without asking anything
    assert.deepEqual(await sender.refresh(), [])
    assert.deepEqual(contextKey(), [false])
    assert.equal(await sender.run(), undefined)
    assert.match(calls('warning').at(-1).text, /no agent is attached/)
    assert.equal(calls('input').length, 0)

    // one agent attaches: the key turns true
    const claude = await mcp(root, 'Claude Code')
    agents.push(claude)
    await until(async () => (await sender.refresh()).length === 1, 30000)
    assert.deepEqual(contextKey(), [false, true])

    // an editor selection: its range, and what the language server resolved in it as the session's selection
    const conn = createMessageConnection(...Object.values(transports(link)))
    conn.listen()
    new PcbjsSession(conn, { select() {}, preview() {}, applyEdit: async () => true, uri: f => pathToFileURL(f).href })
    await conn.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {}, initializationOptions: initializationOptions('0.3.0') })
    await conn.sendNotification('initialized', {})
    const uri = pathToFileURL(file).href
    await conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
    const line = text.split('\n').findIndex(l => l.includes('<TP1 at='))
    const sel = { start: { line, character: 4 }, end: { line, character: 24 } }
    openDoc(file, text, { selections: [new vscode.Selection(new vscode.Position(line, 4), new vscode.Position(line, 24))] })
    await until(async () => {
      await conn.sendNotification('pcbjs/focus', { textDocument: { uri }, position: sel.end, selections: [sel] })
      return held.get('Main')?.includes('TP1')
    }, 60000)

    ui.answers.push(['input', 'move TP1 left'])
    const id = await sender.run(vscode.Uri.file(file))
    assert.ok(id, 'one agent: sent at once')
    assert.equal(calls('pick').length, 0)
    assert.equal(calls('input').at(-1).placeHolder, PLACEHOLDER)
    assert.ok(status().some(s => s.endsWith('Sent to Claude Code')))
    const m = (await messages()).find(e => e.id === id).data
    assert.deepEqual([m.from, m.comment, m.board, m.target, m.refs], ['editor', 'move TP1 left', 'Main', null, ['TP1']])
    assert.deepEqual(m.ranges, [{ file, line: line + 1, col: 5, endLine: line + 1, endCol: 24 }])
    assert.match(m.snapshot, /\S/)

    // the agent's next tool result starts with it, and the extension says Read by
    const r = await claude.call('docs', { topic: 'mcp' })
    assert.match(r.content[0].text, /move TP1 left/)
    await until(() => status().some(s => s.endsWith('Read by Claude Code')), 10000)

    // a second agent: a quick pick of name, responsibility and age, the last choice first
    const codex = await mcp(root, 'Codex')
    agents.push(codex)
    await until(async () => (await sender.refresh()).length === 2, 30000)
    ui.answers.push(['pick', c => c.items.find(i => i.agent.name === 'Codex')], ['input', ''])
    const viewed = await sender.run({ viewer: true, board: 'Main', target: null, refs: ['TP2', 'TP1'] })
    const pick = calls('pick').at(-1)
    assert.deepEqual(
      pick.items.map(i => i.label),
      ['$(hubot) Claude Code', '$(hubot) Codex'],
    )
    assert.equal(pick.items[1].description, root, 'the folder until the agent describes its task')
    assert.match(pick.items[0].detail, /^attached \d+ s ago$/)
    const v = (await messages()).find(e => e.id === viewed).data
    assert.deepEqual([v.comment, v.refs, v.ranges, v.board], ['', ['TP2', 'TP1'], [], 'Main'])
    assert.equal(v.to, (await server.request('session/clients')).find(c => c.name === 'Codex').client)

    // a finding by its exact id, with the rows selected beside it; Codex is now the default
    const finding = { id: 'f', label: 'clearance', action: { kind: 'finding', board: 'Main', id: 'drc:clearance:0123456789ab' } }
    const part = { id: 'r', label: 'TP2', action: { kind: 'ref', board: 'Main', ref: 'TP2' } }
    ui.answers.push(['pick', c => c.items[0]], ['input', 'why?'])
    const told = await sender.run(finding, [finding, part])
    assert.equal(calls('pick').at(-1).items[0].agent.name, 'Codex', 'the last choice is the default')
    const f = (await messages()).find(e => e.id === told).data
    assert.deepEqual([f.finding, f.refs, f.board], ['drc:clearance:0123456789ab', ['drc:clearance:0123456789ab', 'TP2'], 'Main'])

    // Codex leaves without reading either: both come back as returned, and Send to agent stays on for Claude Code
    await codex.end()
    await until(() => calls('warning').filter(c => /Returned: Codex left/.test(c.text)).length === 2, 20000)
    await until(async () => (await sender.refresh()).length === 1, 20000)
    await claude.end()
    await until(async () => (await sender.refresh()).length === 0, 20000)
    assert.deepEqual(contextKey(), [false, true, false])
    conn.dispose()
  } finally {
    for (const a of agents) void a.end()
    await server.stop()
    execFileSync(process.execPath, [BIN, 'session', 'stop'], { cwd: root })
  }
})
