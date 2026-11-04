import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { fakeSpawn, mockSession, sleep, until } from './fake.mjs'
import { panels } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { PcbjsServer, findBinary, findGlobal, launcher, serveArgs } = require('../dist/server.cjs')
const { attachWorktree, detachWorktree, listWorktrees, ownProjects, worktreeStates, worktreeNodes } = require('../dist/worktrees.cjs')
const { Sync } = require('../dist/sync.cjs')
const { Preview } = require('../dist/preview.cjs')
const { parseEnvelope, encode, devUrl, viewerUrl, themeName } = require('../dist/protocol.cjs')

const TMP = realpathSync(mkdtempSync(path.join(tmpdir(), 'pcbjs-server-')))
after(() => rmSync(TMP, { recursive: true, force: true }))
const ROOT = path.join(TMP, 'demo')
const BIN = path.join(TMP, 'node_modules/@pcbjs/pcbjs/bin/pcbjs.js')

const readyFor = (over = {}) => ({
  port: 5301,
  host: '127.0.0.1',
  urls: ['http://127.0.0.1:5301/'],
  root: ROOT,
  pid: process.pid,
  version: '0.0.1',
  protocol: 2,
  major: 1,
  capabilities: ['bye', 'lsp'],
  session: 'mock0001',
  mode: 'rw',
  projects: [],
  ...over,
})

/** A server whose folders have no live session until a test names one in `live`; the sessions are mock sockets. */
function makeServer(extra = {}) {
  const { spawn, calls } = fakeSpawn(extra.child)
  const live = new Map()
  const changes = []
  const server = new PcbjsServer({
    folders: () => [ROOT],
    exists: p => p === BIN,
    realpath: p => p,
    nodePath: () => '/usr/bin/node',
    spawn,
    devInfo: root => live.get(root),
    backoffMinMs: 20,
    backoffMaxMs: 80,
    onChange: () => changes.push(server.state.kind),
    ...extra,
  })
  return { server, calls, changes, live }
}

const DOTBIN = process.platform === 'win32' ? 'pcbjs.cmd' : 'pcbjs'

test('envelope parsing and the viewer URL helpers', () => {
  assert.deepEqual(parseEnvelope('{"event":"pcbjs:ide:log","data":{"level":"info","text":"x"}}'), { event: 'pcbjs:ide:log', data: { level: 'info', text: 'x' } })
  assert.deepEqual(parseEnvelope(Buffer.from('{"event":"pcbjs:ide:bye"}')), { event: 'pcbjs:ide:bye', data: undefined })
  for (const bad of ['', 'nope', '[]', 'null', '{"type":"custom","event":""}', '{"data":1}', '{"event":3}']) assert.equal(parseEnvelope(bad), undefined, bad)
  assert.equal(encode('pcbjs:ide:hello', { name: 'n' }), '{"event":"pcbjs:ide:hello","data":{"name":"n"}}')
  assert.equal(devUrl(readyFor({ urls: ['http://192.168.1.2:5301/', 'http://localhost:5301/'] })), 'http://localhost:5301/')
  assert.equal(devUrl(readyFor({ urls: [], host: '0.0.0.0' })), 'http://127.0.0.1:5301/')
  assert.equal(viewerUrl('http://127.0.0.1:5301/', 'dark'), 'http://127.0.0.1:5301/?ide=1&theme=dark')
  assert.deepEqual([1, 2, 3, 4].map(themeName), ['light', 'dark', 'hc', 'hc'])
})

test('findBinary walks up from the folder to the nearest node_modules/.bin/pcbjs, then the package bin', () => {
  const BIN = path.resolve('/work/repo/node_modules/@pcbjs/pcbjs/bin/pcbjs.js')
  const root = path.resolve('/work/repo/examples/demo')
  const seen = []
  const exists = p => (seen.push(p), p === BIN)
  assert.equal(findBinary(root, exists), BIN)
  assert.deepEqual(seen, [
    path.join(root, 'node_modules/.bin', DOTBIN),
    path.join(root, 'node_modules/@pcbjs/pcbjs/bin/pcbjs.js'),
    path.resolve('/work/repo/examples/node_modules/.bin', DOTBIN),
    path.resolve('/work/repo/examples/node_modules/@pcbjs/pcbjs/bin/pcbjs.js'),
    path.resolve('/work/repo/node_modules/.bin', DOTBIN),
    BIN,
  ])
  const dot = path.resolve('/work/repo/node_modules/.bin', DOTBIN)
  assert.equal(
    findBinary(root, p => p === dot || p === BIN),
    dot,
    '.bin first',
  )
  assert.equal(
    findBinary(root, () => false),
    undefined,
  )
})

test('no live session: session serve starts detached in the first folder, its output to the session log, and the link connects to it', async () => {
  const OTHER = path.join(TMP, 'other')
  const mock = await mockSession(readyFor(), (m, send) => {
    if (m.method === 'session/attach') send({ jsonrpc: '2.0', id: m.id, result: { session: 'mock0001' } })
  })
  const { server, calls, live } = makeServer({ folders: () => [ROOT, OTHER] })
  const linked = []
  server['o'].onLink = l => linked.push(l)
  const started = server.start()
  await until(() => calls.length === 1)
  const { command, args, options } = calls[0]
  assert.equal(command, '/usr/bin/node')
  assert.deepEqual(args, [BIN, ...serveArgs([ROOT, OTHER])])
  assert.deepEqual(serveArgs([ROOT]), ['session', 'serve', '--workspace', ROOT, '--port', '0', '--host', '127.0.0.1'])
  assert.equal(options.cwd, ROOT)
  assert.equal(options.detached, true)
  assert.equal(options.stdio[0], 'ignore')
  assert.equal(typeof options.stdio[1], 'number')
  assert.equal(options.env.NO_COLOR, '1')
  assert.equal(server.state.kind, 'attaching', 'attaching until the session writes its dev.json')
  live.set(ROOT, mock.dev)
  await started
  await until(() => mock.frames.some(f => f.method === 'session/attach'))
  assert.deepEqual(mock.frames.find(f => f.method === 'session/attach').params, { folders: [ROOT, OTHER] })
  assert.deepEqual(server.state, { kind: 'running', url: 'http://127.0.0.1:5301/', info: readyFor(), older: true })
  assert.deepEqual([server.pid, server.session, linked.length], [process.pid, 'mock0001', 1])
  assert.equal(server.owner(path.join(ROOT, 'pcb.tsx')).link, server.client)
  assert.equal(server.owner('/elsewhere/x.tsx'), undefined, 'a file outside the folders has no owner')
  assert.ok(readFileSync(path.join(ROOT, '.pcbjs', 'log', 'session.log'), 'utf8') !== undefined)
  await server.start()
  assert.equal(calls.length, 1, 'start while running is a no-op')
  await server.stop()
  await mock.close()
})

test('a live session is connected to, none started; boards, scopes and events reach the server', async () => {
  const mock = await mockSession(readyFor(), (m, send) => {
    if (m.event !== 'pcbjs:ide:hello') return
    send({ event: 'pcbjs:ide:scopes', data: { scopes: [{ root: ROOT, slug: 'demo' }], displayed: 'demo', single: true } })
    send({ event: 'pcbjs:ide:boards', data: { boards: [{ name: 'Blinky', title: 'Blinky', entry: 'pcb.tsx' }] } })
    send({ event: 'session/state', data: { snapshot: null } })
  })
  const events = []
  const { server, calls, live } = makeServer({ onEvent: (_l, e, d) => events.push([e, d]) })
  live.set(ROOT, mock.dev)
  await server.start()
  await until(() => server.boards && server.scopes && events.length)
  assert.equal(calls.length, 0)
  assert.deepEqual(
    server.boards.boards.map(b => b.name),
    ['Blinky'],
  )
  assert.deepEqual(events, [['session/state', { snapshot: null }]])
  assert.ok(server.lines.some(l => l.startsWith('session mock0001')))
  await server.stop()
  await mock.close()
})

test('a folder click waits for its project to compile: whenScope resolves on the compile event, never by polling the scopes', async () => {
  const empty = { root: ROOT, slug: 'demo', route: '/', displayed: true, boards: [] }
  const mock = await mockSession(readyFor(), (m, send) => {
    if (m.event === 'pcbjs:ide:hello') send({ event: 'pcbjs:ide:scopes', data: { scopes: [empty], displayed: 'demo', single: true } })
  })
  const { server, live } = makeServer()
  live.set(ROOT, mock.dev)
  await server.start()
  await until(() => server.scopes)
  let got
  const waiting = server.whenScope(s => s.root === ROOT && s.boards.length > 0, 5000).then(s => (got = s))
  await sleep(50)
  assert.equal(got, undefined, 'nothing compiled yet')
  // the session announces the scopes, then logs the compile that changed them
  mock.send({ event: 'pcbjs:ide:scopes', data: { scopes: [{ ...empty, boards: [{ name: 'Blinky' }] }], displayed: 'demo', single: true } })
  await sleep(50)
  assert.equal(got, undefined, 'a scopes message alone wakes no waiter')
  mock.send({
    event: 'session/event',
    data: { id: 'mock0001:1', t: 0, kind: 'compile', project: ROOT, by: null, data: { state: 'started', run: 1, tier: 'quiet', entries: ['pcb.tsx'] } },
  })
  await waiting
  assert.deepEqual(
    got.boards.map(b => b.name),
    ['Blinky'],
  )
  await server.stop()
  await mock.close()
})

test('the .bin link runs under the chosen node, a shell shim as it is, a global pcbjs only with a notice', async () => {
  const real = BIN
  const dot = path.join(TMP, 'node_modules/.bin', DOTBIN)
  assert.deepEqual(
    launcher(dot, '/n/node', () => real),
    { command: '/n/node', args: [real], shell: false },
  )
  assert.deepEqual(
    launcher(dot, '/n/node', p => p),
    { command: dot, args: [], shell: process.platform === 'win32' },
  )
  assert.deepEqual(
    launcher('C:\\p\\pcbjs.cmd', 'node', p => p),
    { command: 'C:\\p\\pcbjs.cmd', args: [], shell: true },
  )

  const a = makeServer({ exists: p => p === dot, realpath: () => real, readyTimeoutMs: 30 })
  await a.server.start()
  assert.equal(a.calls[0].command, '/usr/bin/node')
  assert.equal(a.calls[0].args[0], real)

  const glob = path.join(path.resolve('/opt/g/bin'), DOTBIN)
  assert.equal(
    findGlobal({ PATH: ['/x', '/opt/g/bin'].map(d => path.resolve(d)).join(path.delimiter) }, p => p === glob),
    glob,
  )
  const notices = []
  const b = makeServer({ exists: p => p === glob, realpath: p => p, env: { PATH: path.resolve('/opt/g/bin') }, onGlobal: bin => notices.push(bin), readyTimeoutMs: 30 })
  await b.server.start()
  assert.equal(b.calls[0].command, glob)
  assert.equal(b.calls[0].args[0], 'session')
  assert.deepEqual(notices, [glob])
  await b.server.restart()
  assert.equal(b.calls.length, 2)
  assert.deepEqual(notices, [glob], 'one notice, not one per start')
})

test('a connection lost without bye connects again with a backoff, gives up after maxRestarts; a bye ends it', async () => {
  const mock = await mockSession(readyFor())
  const { server, live } = makeServer({ maxRestarts: 3 })
  live.set(ROOT, mock.dev)
  await server.start()
  assert.equal(server.state.kind, 'running')
  mock.drop()
  await until(() => server.state.kind === 'reconnecting')
  await until(() => server.state.kind === 'running', 3000)
  assert.equal(mock.frames.filter(f => f.event === 'pcbjs:ide:hello').length, 2, 'the same session, dialled again')
  // the session is gone: every attempt fails, each later than the one before
  await mock.close()
  const t0 = Date.now()
  await until(() => server.state.kind === 'failed', 5000)
  assert.match(server.state.reason, /4 times in a row/)
  assert.ok(Date.now() - t0 >= 20 + 40 + 80, 'backoff doubles to its cap')
  await assert.rejects(server.whenReady(), /times in a row/)

  const m2 = await mockSession(readyFor(), (m, send) => m.event === 'pcbjs:ide:hello' && send({ event: 'pcbjs:ide:bye', data: { reason: 'session stop' } }))
  const d = makeServer()
  d.live.set(ROOT, m2.dev)
  await d.server.start()
  m2.drop()
  await until(() => d.server.state.kind === 'detached')
  assert.ok(d.server.lines.includes('session mock0001 ended'), 'the session said bye: it ended on purpose')
  await sleep(60)
  assert.equal(m2.frames.filter(f => f.event === 'pcbjs:ide:hello').length, 1)
  await m2.close()
})

test('stop disconnects, sends no bye, and never connects again', async () => {
  const mock = await mockSession(readyFor())
  const { server, live } = makeServer()
  const waiting = assert.rejects(server.whenReady(), /detached/)
  void server.start()
  await server.stop()
  await waiting
  live.set(ROOT, mock.dev)
  await server.start()
  assert.equal(server.state.kind, 'running')
  await server.stop()
  assert.equal(server.state.kind, 'detached')
  await sleep(60)
  assert.equal(mock.frames.filter(f => f.event === 'pcbjs:ide:bye').length, 0)
  assert.equal(mock.frames.filter(f => f.event === 'pcbjs:ide:hello').length, 1)
  await mock.close()
})

test('failures: no binary, node not runnable, session serve failing with the session log, no session in time', async () => {
  const a = makeServer({ exists: () => false })
  await a.server.start()
  assert.equal(a.server.state.kind, 'failed')
  assert.equal(a.server.state.hint, 'install')
  assert.match(a.server.state.reason, /npm install --save-dev @pcbjs\/pcbjs/)
  assert.equal(a.calls.length, 0)

  // a pcbjs installed in a project of the workspace, below the folders, is found through the candidates
  const inner = path.resolve('/work/top/proj/node_modules/@pcbjs/pcbjs/bin/pcbjs.js')
  const b = makeServer({ candidates: () => [path.join(ROOT, 'proj')], exists: p => p === inner, readyTimeoutMs: 30 })
  b.server['o'].candidates = () => [path.resolve('/work/top/proj')]
  await b.server.start()
  assert.equal(b.calls[0].args[0], inner)

  const c = makeServer()
  const cs = c.server.start()
  await until(() => c.calls.length === 1)
  c.calls[0].child.emit('error', Object.assign(new Error('spawn /usr/bin/node ENOENT'), { code: 'ENOENT' }))
  await cs
  assert.equal(c.server.state.hint, 'node')

  const log = path.join(ROOT, '.pcbjs', 'log', 'session.log')
  const e = makeServer({ readFile: p => (p === log ? 'a\nb\npcbjs: config not found\n' : '') })
  const es = e.server.start()
  await until(() => e.calls.length === 1)
  e.calls[0].child.exit(1)
  await es
  assert.match(e.server.state.reason, /session serve exited with code 1/)
  assert.deepEqual(e.server.state.log, ['a', 'b', 'pcbjs: config not found'])
  assert.equal(e.server.logFile, log)

  const d = makeServer({ readyTimeoutMs: 50 })
  await d.server.start()
  assert.match(d.server.state.reason, /no session came up within/)
  assert.equal(d.server.recent(2).length, 2)
})

test('sync sends the first cursor at once and the last of each frame, sends focus once per file and routes by root', async () => {
  const sent = []
  const targets = [
    { root: '/work/a', focus: d => (sent.push(['a', d]), true) },
    { root: '/work/a/nested', focus: d => (sent.push(['n', d]), true) },
  ]
  const sync = new Sync({ frameMs: 30, route: f => targets.filter(t => f.startsWith(t.root + '/')).sort((x, y) => y.root.length - x.root.length)[0] })
  for (let i = 1; i <= 10; i++) sync.cursor('/work/a/main.tsx', i, 2)
  assert.deepEqual(sent, [['a', { file: '/work/a/main.tsx', line: 1, col: 2 }]], 'the first move goes at once')
  await sleep(70)
  assert.deepEqual(sent.slice(1), [['a', { file: '/work/a/main.tsx', line: 10, col: 2 }]], 'the last of the frame follows')
  sent.length = 0
  assert.ok(sync.focus('/work/a/nested/x.ts'))
  assert.ok(!sync.focus('/work/a/nested/x.ts'), 'the same focus is not repeated')
  assert.ok(!sync.focus('/work/a/readme.md'))
  assert.ok(!sync.focus('/elsewhere/x.tsx'))
  sync.resetFocus()
  assert.ok(sync.focus('/work/a/nested/x.ts'))
  sync.followFocus = false
  assert.ok(!sync.focus('/work/a/main.tsx'))
  sync.cursorSync = false
  sync.cursor('/work/a/main.tsx', 1, 1)
  await sleep(50)
  assert.deepEqual(sent, [
    ['n', { file: '/work/a/nested/x.ts', line: 1, col: 1 }],
    ['n', { file: '/work/a/nested/x.ts', line: 1, col: 1 }],
  ])
  sync.dispose()
})

test('sync: a held key streams one cursor per frame, and leaving the design files clears at once', async () => {
  const sent = []
  const t0 = performance.now()
  const target = { root: '/work/a', focus: d => (sent.push({ d, t: performance.now() - t0 }), true) }
  const sync = new Sync({ route: f => (f.startsWith('/work/a/') ? target : undefined) })
  // an arrow key held for 600 ms, one move every 30 ms: the moves stream, the first at once, none held back past a frame or two
  for (let i = 1; i <= 20; i++) {
    sync.cursor('/work/a/main.tsx', i, 4)
    await sleep(30)
  }
  await sleep(40)
  assert.ok(sent.length >= 10, `${sent.length} sends`)
  assert.ok(sent[0].t < 5, `first after ${sent[0].t} ms`)
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i].t - sent[i - 1].t < 100, `gap ${sent[i].t - sent[i - 1].t} ms`)
  assert.equal(sent.at(-1).d.line, 20)
  // a markdown file, or an editor that is no file, gets focus: 1:1 of the last design file goes out at once, and only once
  sent.length = 0
  sync.cursor('/work/a/README.md', 3, 3)
  assert.deepEqual(
    sent.map(s => s.d),
    [{ file: '/work/a/main.tsx', line: 1, col: 1 }],
  )
  assert.ok(!sync.leave(), 'nothing to clear twice')
  assert.equal(sent.length, 1)
  // a pending cursor dies with the leave, so it cannot bring the highlight back
  sync.cursor('/work/a/main.tsx', 5, 5)
  sync.cursor('/work/a/main.tsx', 6, 5)
  assert.ok(sync.leave())
  await sleep(40)
  assert.deepEqual(
    sent.slice(1).map(s => s.d),
    [
      { file: '/work/a/main.tsx', line: 5, col: 5 },
      { file: '/work/a/main.tsx', line: 1, col: 1 },
    ],
  )
  sync.dispose()
})

test('sync forgets a closed .ts or .tsx file under a root, so the next focus of it goes out again', () => {
  const sent = []
  const targets = [{ root: '/work/a', focus: d => (sent.push(d), true) }]
  const sync = new Sync({ route: f => targets.find(t => f.startsWith(t.root + '/')) })
  assert.ok(sync.focus('/work/a/lib/Part.tsx'))
  assert.ok(sync.close('/work/a/lib/Part.tsx'))
  assert.ok(!sync.close('/work/a/README.md'), 'only .ts and .tsx')
  assert.ok(!sync.close('/elsewhere/x.ts'), 'only under a root')
  assert.ok(sync.focus('/work/a/lib/Part.tsx'), 'a reopened file is focused again')
  assert.deepEqual(sent, [
    { file: '/work/a/lib/Part.tsx', line: 1, col: 1 },
    { file: '/work/a/lib/Part.tsx', line: 1, col: 1 },
  ])
  sync.dispose()
})

test('restartClean ends the session, runs pcbjs cache clear --models over the served folders with the session down, then attaches again', async () => {
  const order = []
  const mock = await mockSession(readyFor(), (m, send) => {
    if (m.method !== 'session/stop') return
    order.push('stop')
    send({ jsonrpc: '2.0', id: m.id, result: null })
  })
  const { server, calls, live, changes } = makeServer()
  live.set(ROOT, mock.dev)
  await server.start()
  assert.deepEqual(server.served, [ROOT])
  const done = server.restartClean()
  assert.deepEqual(server.state, { kind: 'restarting', clearing: true })
  await until(() => calls.length === 1)
  order.push('clear')
  const { command, args, options, child } = calls[0]
  assert.equal(command, '/usr/bin/node')
  assert.deepEqual(args, [BIN, 'cache', 'clear', '--models', ROOT])
  assert.equal(options.cwd, ROOT)
  assert.equal(options.stdio, undefined, 'piped, so its lines reach the output')
  child.stdout.write(`removed ${ROOT}/.pcbjs/cache  2.0 kB\nremoved 1 path, 2.0 kB, from 1 folder\n`)
  child.exit(0)
  assert.equal(await done, 0)
  assert.deepEqual(order, ['stop', 'clear'])
  assert.ok(server.lines.includes(`removed ${ROOT}/.pcbjs/cache  2.0 kB`))
  assert.equal(server.state.kind, 'running')
  assert.ok(changes.includes('restarting') && !changes.includes('detached'), 'restarting until the new session runs')
  await server.stop()
  await mock.close()
})

/** A session on its own port that says its scope after the ready and answers session/stop, then `onStop` names the next. */
async function sessionAt(port, onStop) {
  const url = `http://127.0.0.1:${port}/`
  return mockSession(readyFor({ port, urls: [url] }), (m, send) => {
    if (m.event === 'pcbjs:ide:hello') send({ event: 'pcbjs:ide:scope', data: { scope: 'demo', root: ROOT, route: '/', url } })
    if (m.method !== 'session/stop') return
    onStop()
    send({ jsonrpc: '2.0', id: m.id, result: null })
  })
}

/** Two panes on the server's Coin board, in 2D and 3D, repainted on every change; the html of each pane at each change. */
async function restartRig(ports) {
  const live = new Map()
  const sessions = []
  for (const [i, port] of ports.entries()) sessions.push(await sessionAt(port, () => live.set(ROOT, sessions[i + 1]?.dev)))
  const seen = []
  let preview
  const rig = makeServer({
    devInfo: root => live.get(root),
    onScope: () => preview.follow(rig.server, rig.server.page),
    onChange: () => {
      seen.push(panels.map(p => p.webview.html))
      void preview?.update()
    },
  })
  preview = new Preview({ ensureStarted: async () => {}, board: () => undefined, onChange() {}, icon: { light: '', dark: '' }, graceMs: 0 })
  live.set(ROOT, sessions[0].dev)
  panels.length = 0
  await rig.server.start()
  await preview.open(rig.server, '2d')
  await preview.open(rig.server, '3d', 'new')
  await preview.showBoard(rig.server, 'Coin')
  const close = async () => {
    preview.dispose()
    await rig.server.stop()
    for (const s of sessions) await s.close()
  }
  return { ...rig, preview, seen, close }
}

const frameOf = panel => /<iframe id="viewer" src="([^"]+)"/.exec(panel.webview.html)?.[1].replace(/&amp;/g, '&')
const sentSrc = panel => panel.posted.findLast(m => m.type === 'src')?.src
const coinAt = (port, view) => `http://127.0.0.1:${port}/board/Coin?ide=1&theme=dark&view=${view}&panel=0`

test('restartServer twice, onto a new port and then the same one: each pane shows restarting, then its view and board on the new session', async () => {
  const { server, preview, seen, close } = await restartRig([5301, 5302, 5302])
  try {
    assert.deepEqual(
      panels.map(p => p.posted.findLast(m => m.type === 'post')?.data),
      ['2d', '3d'].map(() => ({ type: 'pcbjs:view', board: 'Coin' })),
    )
    for (const port of [5302, 5302]) {
      seen.length = 0
      await server.restartServer()
      assert.equal(server.url, `http://127.0.0.1:${port}/`)
      await until(() => panels.every((p, i) => frameOf(p) === coinAt(port, ['2d', '3d'][i])))
      assert.ok(
        seen.some(htmls => htmls.every(h => h.includes('restarting the session') && !h.includes('<iframe'))),
        'a restarting page while the session is down',
      )
      assert.ok(panels.every(p => !p.disposed && !p.webview.html.includes('5301')))
      assert.deepEqual(
        preview.tabs.map(t => t.view),
        ['2d', '3d'],
      )
    }
  } finally {
    await close()
  }
})

test('restartClean repaints every pane on the new session with its board, saying it clears the caches while down', async () => {
  const { server, seen, calls, close } = await restartRig([5301, 5303])
  try {
    assert.deepEqual(panels[0].posted.findLast(m => m.type === 'post')?.data, { type: 'pcbjs:view', board: 'Coin' })
    seen.length = 0
    const done = server.restartClean()
    await until(() => calls.length === 1)
    calls[0].child.exit(0)
    assert.equal(await done, 0)
    await until(() => panels.every((p, i) => frameOf(p) === coinAt(5303, ['2d', '3d'][i])))
    assert.ok(seen.some(htmls => htmls.every(h => h.includes('restarting the session, clearing caches'))))
  } finally {
    await close()
  }
})

test('restartClean without a pcbjs to run says so and still attaches again', async () => {
  const mock = await mockSession(readyFor(), (m, send) => m.method === 'session/stop' && send({ jsonrpc: '2.0', id: m.id, result: null }))
  const { server, calls, live } = makeServer({ exists: () => false, env: { PATH: '' } })
  live.set(ROOT, mock.dev)
  await server.start()
  assert.equal(await server.restartClean(), null)
  assert.equal(calls.length, 0)
  assert.ok(server.lines.some(l => l.startsWith('cannot clear the caches')))
  assert.equal(server.state.kind, 'running')
  await server.stop()
  await mock.close()
})

test('the candidates are the own projects of the checkout: a worktree under .claude and an ignored tmp/ project are left out, and Open board attaches exactly that worktree', async () => {
  const repo = path.join(TMP, 'repo')
  const sh = (...args) =>
    execFileSync('git', args, {
      cwd: repo,
      stdio: 'pipe',
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    })
  const project = dir => (mkdirSync(dir, { recursive: true }), writeFileSync(path.join(dir, 'pcb.config.ts'), 'export default {}\n'), dir)
  project(repo)
  project(path.join(repo, 'examples', 'x'))
  writeFileSync(path.join(repo, '.gitignore'), 'tmp/\n')
  sh('init', '-q', '-b', 'main')
  sh('add', '.')
  sh('commit', '-q', '-m', 'boards')
  const tmpProject = project(path.join(repo, 'tmp', 'p'))
  const wt = path.join(repo, '.claude', 'worktrees', 'x')
  const inside = path.join(repo, 'lanes', 'y')
  sh('worktree', 'add', '-q', '-b', 'agent/x', wt)
  sh('worktree', 'add', '-q', '-b', 'agent/y', inside)
  const found = [repo, path.join(repo, 'examples', 'x'), tmpProject, wt, path.join(wt, 'examples', 'x'), inside, path.join(inside, 'examples', 'x')]
  const own = await ownProjects(repo, found)
  assert.deepEqual(own, [repo, path.join(repo, 'examples', 'x')], 'no project under .claude, in the ignored tmp/ or in another worktree')

  // a live session of the window and one of a worker in its worktree: only the window's is dialled
  const answer = (m, send) => {
    if (m.method === 'session/attach' || m.method === 'session/detach') send({ jsonrpc: '2.0', id: m.id, result: { projects: [{ root: repo, url: 'http://127.0.0.1:5301/' }] } })
  }
  const mine = await mockSession(readyFor({ root: repo }), answer)
  const worker = await mockSession(readyFor({ root: wt, session: 'work0001' }))
  const live = new Map([
    [repo, { ...mine.dev, root: repo }],
    [wt, { ...worker.dev, root: wt, session: 'work0001' }],
  ])
  const { server, calls } = makeServer({ folders: () => [repo], candidates: () => own, devInfo: root => live.get(root) })
  try {
    await server.start()
    await until(() => server.state.kind === 'running')
    assert.equal(server.links.length, 1)
    assert.equal(calls.length, 0, 'no session started')
    const attaches = () => mine.frames.filter(f => f.method === 'session/attach').map(f => f.params.folders)
    assert.ok(
      attaches()
        .flat()
        .every(f => own.includes(f)),
      JSON.stringify(attaches()),
    )
    const before = attaches().length

    // the Worktrees view lists both from git, neither attached
    const list = await listWorktrees(repo)
    assert.deepEqual(
      list.map(w => w.path),
      [repo, wt, inside],
    )
    const states = worktreeStates(list, [], { scopes: [] }, new Map(), new Map())
    assert.deepEqual(
      worktreeNodes(states, repo)[0].children.map(n => n.context),
      ['worktree', 'worktree'],
    )

    // Open board on one: exactly it attached to the window's session, never a hello to the worker's
    assert.equal(await attachWorktree(server, states[0]), true)
    assert.deepEqual(attaches().slice(before), [[wt]])
    const attached = worktreeStates(list, [], { scopes: [{ root: wt, route: '/x/', boards: [{ name: 'X' }] }] }, new Map(), new Map())
    assert.equal(await attachWorktree(server, attached[0]), false, 'an attached worktree is not attached again')
    assert.deepEqual(
      worktreeNodes(attached, repo)[0].children.map(n => [n.context, n.description.split(' · ')[0]]),
      [
        ['worktree.attached', 'attached'],
        ['worktree', 'no agent'],
      ],
    )
    assert.deepEqual(await detachWorktree(server, attached[0]), [{ root: repo, url: 'http://127.0.0.1:5301/' }])
    assert.deepEqual(
      mine.frames.filter(f => f.method === 'session/detach').map(f => f.params.folders),
      [[wt]],
    )
    assert.equal(worker.frames.length, 0, 'the worker session was never dialled')
  } finally {
    await server.stop()
    await mine.close()
    await worker.close()
  }
})

test('scope notifications and compile waits retain the second session with duplicate routes', async () => {
  const other = path.join(TMP, 'other-session')
  const notices = []
  const mocks = []
  const { server, live } = makeServer({ folders: () => [ROOT, other], onScope: (scope, link) => notices.push([scope, link]) })
  try {
    for (const [i, root] of [ROOT, other].entries()) {
      const mock = await mockSession(readyFor({ root, session: `scope${i}` }), (m, send) => {
        if (m.method) send({ jsonrpc: '2.0', id: m.id, result: {} })
        if (m.event !== 'pcbjs:ide:hello') return
        send({ event: 'pcbjs:ide:scope', data: { root, scope: 'project', route: '/project/', url: 'http://localhost:5301/project/' } })
        send({ event: 'pcbjs:ide:scopes', data: { scopes: [{ root, route: '/project/', displayed: true, boards: [{ name: 'Board' }] }] } })
      })
      mock.dev.session = `scope${i}`
      mocks.push(mock)
      live.set(root, mock.dev)
    }
    await server.start()
    await until(() => server.links.length === 2 && notices.some(([scope]) => scope.root === other) && server.links.every(l => l.scopes))
    const link = server.owner(path.join(other, 'pcb.tsx')).link
    assert.ok(notices.some(([scope, source]) => scope.root === other && source === link))
    const scope = await server.whenScope(s => s.route === '/project/', 100, link)
    assert.equal(scope.root, other)
    await link.request('session/select', { board: 'Board', refs: ['board:Board'], focus: true })
    assert.equal(mocks[0].frames.filter(f => f.method === 'session/select').length, 0)
    assert.equal(mocks[1].frames.filter(f => f.method === 'session/select').length, 1)
  } finally {
    await server.stop()
    await Promise.all(mocks.map(m => m.close()))
  }
})
