// The session process: one per project however many start it, the stale socket and lock of a crashed one recovered, the idle
// grace, the exit when dev.json goes, the socket's mode, the long-path fallback, and the edit modes per connection.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { board } from './fixtures/workspace.mjs'
import { ensureSession, liveSession } from '../dist/session/start.js'
import { connectSession } from '../dist/session/client.js'
import { modeOf } from '../dist/session/clients.js'
import { gitCommonDir, runtimeDir, socketOf } from '../dist/session/paths.js'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const START = join(REPO, 'packages', 'cli', 'dist', 'session', 'start.js')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const POSIX = process.platform !== 'win32'
const ARGS = ['--port', '0', '--host', '127.0.0.1']

const dirs = []
const pids = []
after(() => {
  for (const pid of pids)
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

/** A project outside any git repository, so its session is keyed by its own folder. */
function project(name, parent = tmpdir()) {
  const root = realpathSync(mkdtempSync(join(parent, 'pcbjs-session-')))
  dirs.push(root)
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(root, 'pcb.tsx'), board(name))
  return root
}

const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(fn, ms = 20000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 50))
  }
}

async function stop(info) {
  const c = await connectSession(info.socket, { name: 'test' })
  await c.request('session/stop').catch(() => {})
  c.close()
  await until(() => !alive(info.pid))
}

/** ensureSession in a process of its own, as a second terminal runs it. */
function starter(root, args) {
  const code = `import { ensureSession } from ${JSON.stringify(START)}\nconst r = await ensureSession(${JSON.stringify(root)}, { args: ${JSON.stringify(args)} })\nconsole.log(JSON.stringify({ session: r.info.session, pid: r.info.pid, started: r.started }))\nprocess.exit(0)`
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', d => (out += d))
  child.stderr.on('data', d => (out += d))
  return new Promise((ok, fail) => child.on('exit', c => (c === 0 ? ok(JSON.parse(out.trim().split('\n').pop())) : fail(new Error(out)))))
}

test('two concurrent starters give one session', { timeout: 90000 }, async () => {
  const root = project('Twice')
  const [a, b] = await Promise.all([starter(root, ARGS), starter(root, ARGS)])
  pids.push(a.pid)
  assert.equal(a.session, b.session)
  assert.equal(a.pid, b.pid)
  assert.deepEqual([a.started, b.started].sort(), [false, true], 'one spawned it, the other found it')
  assert.ok(!existsSync(join(root, '.pcbjs', 'session.lock')), 'the lock is released')
  const info = await liveSession(root)
  assert.equal(info.session, a.session)
  assert.match(readFileSync(join(root, '.pcbjs', 'log', 'session.log'), 'utf8'), new RegExp(`session ${a.session}, pid ${a.pid}`))
  await stop(info)
  assert.ok(!existsSync(join(root, '.pcbjs', 'dev.json')), 'stop removes its dev.json')
  if (POSIX) assert.ok(!existsSync(info.socket), 'and its socket')
})

test('a stale socket, lock and dev.json of a crashed session are recovered', { skip: !POSIX, timeout: 90000 }, async () => {
  const root = project('Stale')
  const socket = socketOf(root)
  mkdirSync(dirname(socket), { recursive: true })
  // a process that bound the socket and died without unlinking it
  const dead = spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(socket)}, () => console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] })
  await new Promise(r => dead.stdout.once('data', r))
  dead.kill('SIGKILL')
  await new Promise(r => dead.once('exit', r))
  assert.ok(existsSync(socket))
  writeFileSync(join(root, '.pcbjs', 'session.lock'), JSON.stringify({ pid: dead.pid, at: Date.now() }))
  writeFileSync(join(root, '.pcbjs', 'dev.json'), JSON.stringify({ session: 'deadbeef', pid: dead.pid, socket, root, url: 'http://localhost:1/' }))
  const r = await ensureSession(root, { args: ARGS })
  pids.push(r.info.pid)
  assert.ok(r.started)
  assert.notEqual(r.info.session, 'deadbeef')
  assert.equal(r.info.socket, socket)
  const c = await connectSession(socket, { name: 'test' })
  assert.equal(c.ready.session, r.info.session)
  c.close()
  await stop(r.info)
})

test('the idle grace: --grace 1 ends the session a second after its last client left', { timeout: 90000 }, async () => {
  const root = project('Grace')
  const { info } = await ensureSession(root, { args: [...ARGS, '--grace', '1'] })
  pids.push(info.pid)
  const c = await connectSession(info.socket, { name: 'test', role: 'agent' })
  const st = await c.request('session/status')
  assert.equal(st.grace, 1)
  assert.deepEqual(
    st.clients.map(x => [x.name, x.role, x.mode]),
    [['test', 'agent', 'rw']],
  )
  // held while a client is attached
  await new Promise(r => setTimeout(r, 2500))
  assert.ok(alive(info.pid))
  const t0 = Date.now()
  c.close()
  await until(() => !alive(info.pid), 15000)
  assert.ok(Date.now() - t0 >= 900, `ended after ${Date.now() - t0} ms`)
  assert.ok(!existsSync(join(root, '.pcbjs', 'dev.json')))
  assert.match(readFileSync(join(root, '.pcbjs', 'log', 'session.log'), 'utf8'), /stopping: idle for 1 s/)
})

test('the session exits when its dev.json is deleted', { timeout: 90000 }, async () => {
  const root = project('Gone')
  const { info } = await ensureSession(root, { args: ARGS })
  pids.push(info.pid)
  const c = await connectSession(info.socket, { name: 'test' })
  let bye = null
  c.onEvent((e, d) => e === 'pcbjs:ide:bye' && (bye = d))
  unlinkSync(join(root, '.pcbjs', 'dev.json'))
  await until(() => !alive(info.pid), 15000)
  await c.done
  assert.match(bye?.reason ?? '', /dev\.json is gone/)
})

test('the socket is mode 0600 and dev.json too; a long path binds in the 0700 runtime directory', { skip: !POSIX, timeout: 90000 }, async () => {
  const root = project('Mode')
  const { info } = await ensureSession(root, { args: ARGS })
  pids.push(info.pid)
  assert.equal(info.socket, join(root, '.pcbjs', 'session'))
  assert.equal(statSync(info.socket).mode & 0o777, 0o600)
  assert.equal(statSync(join(root, '.pcbjs', 'dev.json')).mode & 0o777, 0o600)
  await stop(info)

  const deep = join(project('Deep'), 'a-folder-name-long-enough-to-push-the-socket-path', 'past-the-sun-path-limit-of-macos')
  mkdirSync(deep, { recursive: true })
  writeFileSync(join(deep, 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
  writeFileSync(join(deep, 'pcb.tsx'), board('Deep'))
  const long = await ensureSession(deep, { args: ARGS })
  pids.push(long.info.pid)
  // the runtime directory, or the temporary one when XDG_RUNTIME_DIR is long too
  assert.ok([runtimeDir(), join(tmpdir(), `pcbjs-${process.getuid()}`)].includes(dirname(long.info.socket)), long.info.socket)
  assert.ok(Buffer.byteLength(long.info.socket) < 100)
  assert.equal(statSync(dirname(long.info.socket)).mode & 0o777, 0o700)
  assert.equal(statSync(long.info.socket).mode & 0o777, 0o600)
  await stop(long.info)
})

test('a long project path under a long XDG_RUNTIME_DIR binds in the temporary directory', { skip: !POSIX }, () => {
  const was = process.env.XDG_RUNTIME_DIR
  const run = mkdtempSync(join(tmpdir(), 'pcbjs-a-runtime-directory-long-enough-that-the-socket-in-it-is-past-the-limit-'))
  process.env.XDG_RUNTIME_DIR = run
  try {
    const deep = join(run, 'a-folder-name-long-enough-to-push-the-socket-path', 'past-the-sun-path-limit-of-macos')
    const s = socketOf(deep)
    assert.equal(dirname(s), join(tmpdir(), `pcbjs-${process.getuid()}`))
    assert.ok(Buffer.byteLength(s) < 100, s)
    assert.equal(statSync(dirname(s)).mode & 0o777, 0o700)
  } finally {
    if (was === undefined) delete process.env.XDG_RUNTIME_DIR
    else process.env.XDG_RUNTIME_DIR = was
    rmSync(run, { recursive: true, force: true })
  }
})

test('modes: localhost trusts the socket and loopback, all a LAN client with the token, none nobody', () => {
  const sock = { kind: 'socket', loopback: true }
  const loop = { kind: 'tcp', loopback: true }
  const lan = { kind: 'tcp', loopback: false }
  assert.deepEqual([modeOf(sock, 'localhost'), modeOf(loop, 'localhost'), modeOf(lan, 'localhost', 't', 't')], ['rw', 'rw', 'ro'])
  assert.deepEqual([modeOf(lan, 'all', 'tok', 'tok'), modeOf(lan, 'all', 'tok', 'bad'), modeOf(lan, 'all', 'tok', undefined)], ['rw', 'ro', 'ro'])
  assert.deepEqual([modeOf(sock, 'none'), modeOf(loop, 'none')], ['ro', 'ro'])
})

const lanAddress = () =>
  Object.values(networkInterfaces())
    .flat()
    .find(i => i && i.family === 'IPv4' && !i.internal)?.address

test('a read-only LAN client is refused script; the token, loopback and the socket are not', { skip: !lanAddress() && 'no LAN address', timeout: 90000 }, async () => {
  const root = project('Lan')
  const serve = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '0.0.0.0', '--edit', 'all', '--grace', '30'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  pids.push(serve.pid)
  try {
    await until(() => liveSession(root))
    const info = await liveSession(root)
    assert.equal(info.edit, 'all')
    assert.ok(info.token && info.token.length >= 22, 'a 128-bit token for the LAN')
    const port = new URL(info.url).port
    const rpc = async (host, token) => {
      const ws = new WebSocket(`ws://${host}:${port}/__pcbjs/session${token ? `?token=${token}` : ''}`)
      const frames = []
      ws.on('message', raw => frames.push(JSON.parse(String(raw))))
      await new Promise((ok, fail) => {
        ws.once('open', ok)
        ws.once('error', fail)
      })
      ws.send(JSON.stringify({ event: 'pcbjs:ide:hello', data: { name: 'lan', version: '0', protocol: 2, major: 1, capabilities: [], role: 'agent' } }))
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/script', params: { code: '1' } }))
      await until(() => frames.some(f => f.id === 1) && frames.some(f => f.event === 'pcbjs:ide:ready'), 10000)
      ws.close()
      return { ready: frames.find(f => f.event === 'pcbjs:ide:ready').data, answer: frames.find(f => f.id === 1) }
    }
    const lan = await rpc(lanAddress())
    assert.equal(lan.ready.mode, 'ro')
    assert.equal(lan.answer.error.code, -32001)
    assert.match(lan.answer.error.message, /read-only/)
    const withToken = await rpc(lanAddress(), info.token)
    assert.equal(withToken.ready.mode, 'rw')
    assert.equal(withToken.answer.error, undefined, 'past the gate')
    assert.equal(withToken.answer.result.value.output, '1')
    const loop = await rpc('127.0.0.1')
    assert.equal(loop.ready.mode, 'rw')
    // a page of another site cannot open the session socket
    const foreign = new WebSocket(`ws://127.0.0.1:${port}/__pcbjs/session`, { headers: { origin: 'https://example.com' } })
    await assert.rejects(new Promise((ok, fail) => (foreign.once('open', ok), foreign.once('error', fail))), /403/)
    await stop(info)
  } finally {
    serve.kill('SIGKILL')
  }
})

test('session serve on a root a live session serves exits 0 and names it', { timeout: 90000 }, async () => {
  const root = project('Second')
  const { info } = await ensureSession(root, { args: ARGS })
  pids.push(info.pid)
  const second = spawn(process.execPath, [BIN, 'session', 'serve', ...ARGS], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  second.stdout.on('data', d => (out += d))
  const code = await new Promise(r => second.once('exit', r))
  assert.equal(code, 0)
  assert.match(out, new RegExp(`session ${info.session}, pid ${info.pid}, already serves`))
  assert.ok(alive(info.pid))
  await stop(info)
})

test(
  'each worktree of a repository has its own session: a starter in another worktree starts one, a hello naming a project attaches it without its dev.json, detach drops it',
  { timeout: 120000 },
  async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-repo-')))
    dirs.push(repo)
    const main = join(repo, 'main')
    const sh = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' })
    mkdirSync(join(main, 'proj'), { recursive: true })
    writeFileSync(join(main, 'proj', 'pcb.config.ts'), "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'] })\n")
    writeFileSync(join(main, 'proj', 'pcb.tsx'), board('Tree'))
    sh(['init', '-q'], main)
    sh(['add', '.'], main)
    sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'board'], main)
    sh(['worktree', 'add', '-q', join(repo, 'wt')], main)
    sh(['worktree', 'add', '-q', join(repo, 'wt2')], main)
    for (const d of [main, join(repo, 'wt'), join(repo, 'wt2')]) {
      mkdirSync(join(d, 'node_modules'))
      symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(d, 'node_modules', '@pcbjs'), 'dir')
    }
    assert.equal(gitCommonDir(join(repo, 'wt', 'proj')), gitCommonDir(join(main, 'proj')))
    const a = await ensureSession(join(main, 'proj'), { args: ARGS })
    pids.push(a.info.pid)
    assert.equal(a.info.checkout, main)
    // an agent connecting from a worktree not served yet has it attached, but its dev.json is left to its own session
    const other = join(repo, 'wt2', 'proj')
    const agent = await connectSession(a.info.socket, { name: 'agent', role: 'agent', project: other })
    assert.ok(
      agent.ready.projects.some(p => p.root === other),
      JSON.stringify(agent.ready.projects),
    )
    assert.equal(existsSync(join(other, '.pcbjs', 'dev.json')), false)
    // the editor's Detach on a worktree it attached
    const left = await agent.request('session/detach', { folders: [join(repo, 'wt2')] })
    assert.deepEqual(
      left.projects.map(p => p.root),
      [join(main, 'proj')],
    )
    agent.close()
    const b = await ensureSession(join(repo, 'wt', 'proj'), { args: ARGS })
    pids.push(b.info.pid)
    assert.deepEqual([b.started, b.joined, b.info.checkout], [true, false, join(repo, 'wt')])
    assert.notEqual(b.info.session, a.info.session)
    await stop(b.info)
    await stop(a.info)
  },
)
