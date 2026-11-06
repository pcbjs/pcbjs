// inspect and shot from one compile: several queries in one run, a shot per --select with the layers together, and the
// answer from a live session of the project, through its socket, shot rendered there.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectOutput } from '../dist/project/inspect.js'

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
