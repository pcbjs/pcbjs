// inspect and shot from one compile: several queries in one run, a shot per --select with the layers together, and the
// answer from a live session of the project, through its socket, shot rendered there.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectRequests } from '../dist/cli.js'
import { inspectOutput } from '../dist/project/inspect.js'
import { shotJobs } from '../dist/shot.js'
import { makeStack, stackBoard } from './fixtures/workspace.mjs'
import { ask, sessionOf } from '../dist/session/thin.js'
import { stop } from './fixtures/proc.mjs'

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pcbjs', 'bin', 'pcbjs.js')
const run = (cwd, ...args) =>
  new Promise(done => {
    const p = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } })
    let stdout = '',
      stderr = ''
    p.stdout.on('data', d => {
      stdout += d
    })
    p.stderr.on('data', d => {
      stderr += d
    })
    p.on('close', code => done({ code, stdout, stderr }))
  })

test('inspect: the first argument is the entry when it names a module, every other one a query; --lengths adds tables', () => {
  assert.deepEqual(inspectRequests(['pcb.tsx', 'U1', 'GND', 'J1.3'], 'DATA'), {
    entry: 'pcb.tsx',
    requests: [{ query: 'U1' }, { query: 'GND' }, { query: 'J1.3' }, { query: 'DATA', lengths: true }],
  })
  assert.deepEqual(inspectRequests(['U1'], ['A', 'B']), { entry: undefined, requests: [{ query: 'U1' }, { query: 'A', lengths: true }, { query: 'B', lengths: true }] })
  // as before: a bare --lengths makes the query its filter, or prints every route
  assert.deepEqual(inspectRequests(['pcb.tsx', 'DATA'], true), { entry: 'pcb.tsx', requests: [{ query: 'DATA', lengths: true }] })
  assert.deepEqual(inspectRequests([], true), { entry: undefined, requests: [{ lengths: true }] })
  assert.deepEqual(inspectRequests([], undefined), { entry: undefined, requests: [{}] })
})

test('inspect: one answer prints as before, several share the frame lines under == headings, and JSON lists them', () => {
  const r = (q, found = true) => ({ text: ['board', 'outline', `answer ${q}`], json: { frame: { board: 'b' }, q }, found })
  assert.deepEqual(inspectOutput([r('U1')], [{ query: 'U1' }], false), ['board', 'outline', 'answer U1'])
  assert.deepEqual(inspectOutput([r('U1'), r('D', false)], [{ query: 'U1' }, { query: 'D', lengths: true }], false), [
    'board',
    'outline',
    '',
    '== U1',
    'answer U1',
    '',
    '== --lengths D',
    'answer D',
  ])
  const j = JSON.parse(inspectOutput([r('U1'), r('D', false)], [{ query: 'U1' }, { query: 'D', lengths: true }], true)[0])
  assert.deepEqual(j, {
    frame: { board: 'b' },
    results: [
      { query: 'U1', found: true, q: 'U1' },
      { query: 'D', lengths: true, found: false, q: 'D' },
    ],
  })
})

test('shot: one shot per --select and view, the layers shown together in one', () => {
  const files = shotJobs([{ entry: '/p/b.tsx', name: 'B', targets: [null] }], ['2d', '3d'], '/o', { layers: ['F.Cu', 'B.Cu'] }, ['U1', 'Q1']).map(j => j.file)
  assert.deepEqual(
    files,
    ['/o/B-2d-select-U1-F.Cu+B.Cu.png', '/o/B-2d-select-Q1-F.Cu+B.Cu.png', '/o/B-3d-select-U1-F.Cu+B.Cu.png', '/o/B-3d-select-Q1-F.Cu+B.Cu.png'].map(f => join(f)),
  )
  const [j] = shotJobs([{ entry: '/p/b.tsx', name: 'B', targets: [null] }], ['3d'], '/o', {}, ['U1'])
  assert.deepEqual(j.spec, { view: '3d', entry: '/p/b.tsx', frame: 'U1', highlight: ['U1'] }, '--select frames and highlights')
})

// ---- a session of the project answers ----
let w, session, root
before(async () => {
  w = makeStack()
  root = realpathSync(w.a)
  session = spawn(process.execPath, [BIN, 'session', 'serve', '--port', '0', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  session.stdout.on('data', d => (out += d))
  session.stderr.on('data', d => (out += d))
  for (let i = 0; i < 600 && !/\[pcbjs\] session \w+, pid/.test(out); i++) await new Promise(r => setTimeout(r, 50))
})
after(async () => {
  if (session && session.exitCode === null) {
    await stop(session)
  }
  if (w) rmSync(w.root, { recursive: true, force: true })
})

test('session reuse: inspect with several queries answers from the session in one line, and --fresh compiles here', async () => {
  const r = await run(w.a, 'inspect', 'TP1', 'V', '--lengths', 'W')
  // the board has no net W: that one answer is not found, so the run exits with 1 after printing all
  assert.equal(r.code, 1, r.stderr)
  assert.match(r.stderr, /^session \w{8}  snapshot \w{8}\.\d+; --fresh compiles here$/m)
  assert.doesNotMatch(r.stderr, /^compiled /m)
  assert.match(r.stdout, /^A 1  pcb\.tsx  mm/)
  assert.match(r.stdout, /^== TP1\nTP1  V  /m)
  assert.match(r.stdout, /^== V\nnet V  2 pads/m)
  assert.match(r.stdout, /^== --lengths W\nno route of the net, pair or group W$/m)
  const f = await run(w.a, 'inspect', 'TP1', '--fresh')
  assert.equal(f.code, 0, f.stderr)
  assert.match(f.stderr, /^compiled  pcb\.tsx  \d/m)
  assert.doesNotMatch(f.stderr, /^session /m)
})

test('session reuse: an edit just made is compiled first, so the answer is never older than the files', async () => {
  writeFileSync(join(w.a, 'pcb.tsx'), stackBoard('A', '7'))
  const r = await run(w.a, 'inspect', 'TP1')
  assert.match(r.stderr, /^session /m)
  assert.match(r.stdout, /^A 7  pcb\.tsx  /)
})

test('session reuse: shot renders in the session by its worker, each PNG naming the snapshot, a bad spec refused', async () => {
  const r = await run(w.a, 'shot', '--view', '3d', '--view', '2d', '--size', '200x150', '--select', 'TP1')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const m = /^session \w{8}  snapshot (\S+); --fresh compiles here$/m.exec(r.stderr)
  assert.ok(m, r.stderr)
  for (const f of ['A-2d-select-TP1.png', 'A-3d-select-TP1.png']) assert.ok(existsSync(join(w.a, '.pcbjs', 'shots', f)), f)
  assert.match(r.stdout, new RegExp(`A-3d-select-TP1\\.png  200x150  .*A 3d iso; snapshot ${m[1].replace('.', '\\.')}; frame TP1`))
  const info = await sessionOf(root)
  await assert.rejects(ask(info, 'test', root, 'session/render', { project: root, spec: { view: '4d' } }), /view must be 2d, 3d or sch/)
  const e = await ask(info, 'test', root, 'session/render', { project: root, spec: { view: 'sch', size: [100, 80] } })
  assert.equal(Buffer.from(e.value.png, 'base64').toString('latin1', 1, 4), 'PNG')
  assert.equal(e.value.width, 100)
  assert.match(e.value.legend, new RegExp(`^A sch; snapshot ${e.snapshot.replace('.', '\\.')}$`))
})

test('session reuse: without a live session inspect compiles itself', async () => {
  const info = await sessionOf(root)
  await ask(info, 'test', root, 'session/stop', {}).catch(() => {})
  if (session.exitCode === null && session.signalCode === null) await new Promise(done => session.once('exit', done))
  assert.ok(!existsSync(join(w.a, '.pcbjs', 'dev.json')))
  const r = await run(w.a, 'inspect', 'TP1', 'TP2')
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /^compiled  pcb\.tsx  /m)
  assert.match(r.stdout, /^== TP2$/m)
})
