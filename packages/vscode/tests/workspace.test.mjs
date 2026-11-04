// The extension side of the session, without VS Code: a PcbjsServer that starts a real session with `pcbjs session serve` and
// dials its socket, the language client over the same connection, an agent in a second worktree that describes its task, edits and
// is told to stop, the Worktrees node and the Agent activity view built from what the session says, and a reconnect once the
// session is killed and a new one starts.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMessageConnection } from 'vscode-jsonrpc'
import { PROTOCOL } from '@pcbjs/core/protocol'
import { until } from './fake.mjs'
import { board } from '../../cli/tests/fixtures/workspace.mjs'

const require = createRequire(import.meta.url)
const { PcbjsServer } = require('../dist/server.cjs')
const { PcbjsSession, transports, initializationOptions } = require('../dist/lsp-client.cjs')
const { Activity, agentNodes } = require('../dist/agents.cjs')
const { listWorktrees, changedFiles, worktreeStates, worktreeNodes, bannerOf } = require('../dist/worktrees.cjs')

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pcbjs-ext-')))
const main = path.join(tmp, 'main')
const wt = path.join(tmp, 'wt')
const pids = new Set()
after(async () => {
  for (const pid of pids)
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  await until(() => [...pids].every(pid => !alive(pid)), 10000)
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
const config = "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n"

/** A repository with one project and a second worktree on a branch, both with pcbjs installed. */
function repo() {
  mkdirSync(main, { recursive: true })
  writeFileSync(path.join(main, '.gitignore'), 'node_modules\n.pcbjs\n')
  writeFileSync(path.join(main, 'pcb.config.ts'), config)
  writeFileSync(path.join(main, 'pcb.tsx'), board('Main'))
  git(main, 'init', '-q', '-b', 'main')
  git(main, 'add', '.')
  git(main, 'commit', '-q', '-m', 'board')
  git(main, 'worktree', 'add', '-q', '-b', 'agent/usb', wt)
  for (const d of [main, wt]) {
    mkdirSync(path.join(d, 'node_modules'))
    symlinkSync(path.join(REPO, 'node_modules', '@pcbjs'), path.join(d, 'node_modules', '@pcbjs'), 'dir')
  }
}

/** An agent's own connection to the socket: hello, then `session/*` requests and LSP, one JSON object per line. */
async function agent(socket, project) {
  const s = connect(socket)
  const frames = []
  const waiting = new Map()
  let id = 0
  let rest = ''
  s.on('data', d => {
    rest += d
    let nl
    while ((nl = rest.indexOf('\n')) >= 0) {
      const m = JSON.parse(rest.slice(0, nl))
      rest = rest.slice(nl + 1)
      frames.push(m)
      if (m.jsonrpc && waiting.has(m.id)) waiting.get(m.id)(m)
    }
  })
  const send = m => s.write(JSON.stringify(m) + '\n')
  await new Promise(r => s.once('connect', r))
  send({ event: 'pcbjs:ide:hello', data: { name: 'Claude Code', version: '1', protocol: 2, major: 1, capabilities: [], role: 'agent', project } })
  await until(() => frames.some(f => f.event === 'pcbjs:ide:ready'), 20000)
  const request = (method, params = {}) =>
    new Promise((ok, fail) => {
      const n = ++id
      waiting.set(n, m => (m.error ? fail(new Error(m.error.message)) : ok(m.result)))
      send({ jsonrpc: '2.0', id: n, method, params })
    })
  return { frames, send, request, close: () => s.end() }
}

test('a real session started and dialled, an agent in a worktree described, edited and told to stop, then a reconnect to the next session', { timeout: 240000 }, async () => {
  repo()
  const events = []
  const linked = []
  const server = new PcbjsServer({
    folders: () => [main],
    name: 'vscode-pcbjs',
    version: '0.3.0',
    nodePath: () => process.execPath,
    onLink: l => linked.push(l),
    onEvent: (_l, e, d) => events.push([e, d]),
    readyTimeoutMs: 120000,
    backoffMinMs: 100,
  })
  let ag
  try {
    await server.start()
    const url = await server.whenReady()
    pids.add(server.pid)
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
    const dev = JSON.parse(readFileSync(path.join(main, '.pcbjs', 'dev.json'), 'utf8'))
    assert.equal(server.session, dev.session)
    const link = server.client
    assert.equal(link.dev.socket, dev.socket, 'dialled through the socket dev.json names')
    assert.ok(existsSync(dev.socket))
    assert.ok(readFileSync(path.join(main, '.pcbjs', 'log', 'session.log'), 'utf8').includes(`session ${dev.session}`), 'its output in the session log')
    await until(() => server.boards?.boards.some(b => b.name === 'Main'), 60000)

    // the language client on the same connection
    const selects = []
    const conn = createMessageConnection(...Object.values(transports(link)))
    conn.listen()
    new PcbjsSession(conn, {
      select: p => selects.push({ uri: p.primary.uri, range: p.items[0].ranges[p.primary.index] }),
      preview() {},
      applyEdit: async () => true,
      uri: f => pathToFileURL(f).href,
    })
    const init = await conn.sendRequest('initialize', { processId: null, rootUri: null, capabilities: {}, initializationOptions: initializationOptions('0.3.0') })
    assert.equal(init.capabilities.experimental.pcbjs.protocol, PROTOCOL)
    await conn.sendNotification('initialized', {})
    await link.request('session/events', { follow: true, kind: ['edit', 'save', 'findings', 'message', 'delivered'] })

    // an agent connects from inside the second worktree: the session attaches it and lists the agent there
    ag = await agent(dev.socket, wt)
    const described = await ag.request('session/describe', { task: 'route the USB pair', plan: ['move J1', 'route D+ and D-'] })
    assert.ok(described.event)
    await until(() => events.some(([e, d]) => e === 'session/event' && d.kind === 'message' && d.data.plan), 10000)
    const planned = events.find(([e, d]) => e === 'session/event' && d.kind === 'message' && d.data?.plan)
    assert.ok(planned, 'the plan reached the editor as a message')
    assert.equal(planned[1].by.name, 'Claude Code')
    const clients = await server.request('session/clients')
    const me = clients.find(c => c.role === 'agent')
    assert.deepEqual([me.name, me.root, me.task, me.plan], ['Claude Code', wt, 'route the USB pair', ['move J1', 'route D+ and D-']])
    assert.ok(clients.some(c => c.role === 'editor' && c.name === 'vscode-pcbjs'))

    // the agent edits a file of its worktree through its own document sync
    writeFileSync(path.join(wt, 'notes.ts'), 'export const N = 1\n')
    await ag.request('initialize', { processId: null, rootUri: pathToFileURL(wt).href, capabilities: {} })
    ag.send({ jsonrpc: '2.0', method: 'initialized', params: {} })
    const uri = pathToFileURL(path.join(wt, 'pcb.tsx')).href
    ag.send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescriptreact', version: 1, text: board('Main') } } })
    ag.send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: board('Main') + '\n// usb\n' }] } })
    await until(() => events.some(([e, d]) => e === 'session/event' && d.kind === 'edit' && d.by?.role === 'agent'), 20000)

    // the Agent activity view from the clients and the events
    const activity = new Activity()
    activity.clients(clients)
    for (const [e, d] of events) if (e === 'session/event') activity.event(d)
    const [row] = activity.list()
    assert.equal(row.task, 'route the USB pair')
    assert.deepEqual(row.plan, ['move J1', 'route D+ and D-'])
    assert.deepEqual(
      row.files.map(f => f.file),
      [path.join(wt, 'pcb.tsx')],
    )
    const [node] = agentNodes(activity)
    assert.equal(node.context, 'agent', 'Stop and tell sits on an attached agent')
    assert.match(node.description, /route the USB pair/)

    // the Worktrees node: the second worktree with its agent, task and changed files
    const list = await listWorktrees(main)
    assert.deepEqual(
      list.map(w => [w.path, w.branch]),
      [
        [main, 'main'],
        [wt, 'agent/usb'],
      ],
    )
    const changed = new Map([[wt, await changedFiles(list[1], list[0])]])
    assert.deepEqual(changed.get(wt), ['notes.ts'])
    await until(() => server.scopes?.scopes.some(s => s.root === wt), 20000)
    const states = worktreeStates(list, clients, server.scopes, changed, new Map())
    assert.equal(states[0].agents[0].name, 'Claude Code')
    assert.equal(bannerOf(states[0]), 'Worktree agent/usb, Claude Code: route the USB pair')
    const [wtNode] = worktreeNodes(states, main)[0].children
    assert.equal(wtNode.context, 'worktree.attached', "the agent's hello attached it")
    assert.match(wtNode.description, /^attached · Claude Code · route the USB pair · 1 changed/)
    assert.ok(wtNode.children.some(c => c.action?.kind === 'diff' && c.action.right === path.join(wt, 'notes.ts')))
    assert.ok(states[0].scopes[0].route, 'its project has a route the preview can switch to')

    // Stop and tell: a message event to the agent, delivered on its connection and kept in the log
    const sent = await link.request('session/send', {
      to: me.client,
      comment: 'stop, keep J1 where it is',
      ranges: [{ file: path.join(main, 'pcb.tsx'), line: 3, col: 1, endLine: 3, endCol: 9 }],
    })
    assert.equal(sent.to.client, me.client)
    await until(() => ag.frames.some(f => f.event === 'session/message'), 5000)
    const got = ag.frames.find(f => f.event === 'session/message').data
    assert.deepEqual([got.kind, got.data.to, got.data.from, got.data.comment, got.by.role], ['message', me.client, 'editor', 'stop, keep J1 where it is', 'editor'])
    const log = await link.request('session/events', { since: `${dev.session}.0`, kind: ['message'] })
    assert.ok(log.events.some(e => e.id === got.id))
    await assert.rejects(link.request('session/send', { to: 'c999', comment: 'x' }), /name the agent/)
    await ag.request('session/ack', { ids: [got.id] })
    await until(() => events.some(([e, d]) => e === 'session/event' && d.kind === 'delivered' && d.data.message === got.id), 5000)
    const later = await link.request('session/send', { to: me.client, comment: 'and leave R1' })
    for (const [e, d] of events) if (e === 'session/event') activity.event(d)
    assert.deepEqual(
      activity.get(me.client).notes.map(n => [n.comment, n.state]),
      [
        ['and leave R1', 'sent'],
        ['stop, keep J1 where it is', 'read'],
      ],
    )
    assert.ok(agentNodes(activity)[0].children.some(c => c.description?.startsWith('Read by Claude Code')))

    // the agent leaves: its worktree is marked so
    ag.close()
    await until(async () => !(await server.request('session/clients')).some(c => c.role === 'agent'), 10000)
    await until(() => events.some(([e, d]) => e === 'session/event' && d.kind === 'delivered' && d.data.message === later.id && d.data.returned), 5000)
    for (const [e, d] of events) if (e === 'session/event') activity.event(d)
    assert.equal(activity.get(me.client).notes[0].state, 'returned')
    const seen = new Map([[wt, 'Claude Code']])
    const left = worktreeStates(list, await server.request('session/clients'), server.scopes, changed, seen)
    assert.equal(left[0].left, 'Claude Code')
    assert.match(worktreeNodes(left, main)[0].children[0].description, /Claude Code left/)

    // the session is killed: the server reconnects, finds no live session, starts the next one and dials it
    const first = server.pid
    process.kill(first, 'SIGKILL')
    await until(() => server.state.kind === 'reconnecting', 10000)
    await until(() => server.state.kind === 'running' && server.pid !== first, 120000)
    pids.add(server.pid)
    assert.notEqual(server.session, dev.session)
    assert.equal(linked.length, 2, 'a new link, for a new language client')
    assert.ok(server.lines.some(l => /connecting again/.test(l)))

    // detaching leaves the session running for its other clients
    const pid = server.pid
    await server.stop()
    assert.equal(server.state.kind, 'detached')
    assert.ok(alive(pid))
    const bin = path.join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
    execFileSync(process.execPath, [bin, 'session', 'stop'], { cwd: main })
    await until(() => !alive(pid), 10000)
  } finally {
    ag?.close()
    await server.stop()
  }
})
