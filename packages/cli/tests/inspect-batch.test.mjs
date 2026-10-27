// inspect and shot from one compile: several queries in one run, every --select and --layer combination of shot, and the
// answer from a running dev server of the project when its board is current, through /__pcbjs/cli/.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dev } from '../dist/server.js'
import { inspectRequests } from '../dist/cli.js'
import { inspectOutput } from '../dist/inspect.js'
import { shotCombos, shotJobs } from '../dist/shot.js'
import { makeStack, stackBoard } from './fixtures/workspace.mjs'

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pcbjs', 'bin', 'pcbjs.js')
const run = (cwd, ...args) => new Promise(done => {
  const p = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } })
  let stdout = '', stderr = ''
  p.stdout.on('data', d => { stdout += d }); p.stderr.on('data', d => { stderr += d })
  p.on('close', code => done({ code, stdout, stderr }))
})

test('inspect: the first argument is the entry when it names a module, every other one a query; --lengths adds tables', () => {
  assert.deepEqual(inspectRequests(['pcb.tsx', 'U1', 'GND', 'J1.3'], 'DATA'), { entry: 'pcb.tsx', requests: [{ query: 'U1' }, { query: 'GND' }, { query: 'J1.3' }, { query: 'DATA', lengths: true }] })
  assert.deepEqual(inspectRequests(['U1'], ['A', 'B']), { entry: undefined, requests: [{ query: 'U1' }, { query: 'A', lengths: true }, { query: 'B', lengths: true }] })
  // as before: a bare --lengths makes the query its filter, or prints every route
  assert.deepEqual(inspectRequests(['pcb.tsx', 'DATA'], true), { entry: 'pcb.tsx', requests: [{ query: 'DATA', lengths: true }] })
  assert.deepEqual(inspectRequests([], true), { entry: undefined, requests: [{ lengths: true }] })
  assert.deepEqual(inspectRequests([], undefined), { entry: undefined, requests: [{}] })
})

test('inspect: one answer prints as before, several share the frame lines under == headings, and JSON lists them', () => {
  const r = (q, found = true) => ({ text: ['board', 'outline', `answer ${q}`], json: { frame: { board: 'b' }, q }, found })
  assert.deepEqual(inspectOutput([r('U1')], [{ query: 'U1' }], false), ['board', 'outline', 'answer U1'])
  assert.deepEqual(inspectOutput([r('U1'), r('D', false)], [{ query: 'U1' }, { query: 'D', lengths: true }], false), ['board', 'outline', '', '== U1', 'answer U1', '', '== --lengths D', 'answer D'])
  const j = JSON.parse(inspectOutput([r('U1'), r('D', false)], [{ query: 'U1' }, { query: 'D', lengths: true }], true)[0])
  assert.deepEqual(j, { frame: { board: 'b' }, results: [{ query: 'U1', found: true, q: 'U1' }, { query: 'D', lengths: true, found: false, q: 'D' }] })
})

test('shot: every --select with every --layer, --layer for 2D only once there are several', () => {
  assert.deepEqual(shotCombos('2d', ['U1', 'Q1'], ['F.Cu', 'B.Cu']), [{ select: 'U1', layer: 'F.Cu' }, { select: 'U1', layer: 'B.Cu' }, { select: 'Q1', layer: 'F.Cu' }, { select: 'Q1', layer: 'B.Cu' }])
  assert.deepEqual(shotCombos('3d', ['U1', 'Q1'], ['F.Cu', 'B.Cu']), [{ select: 'U1' }, { select: 'Q1' }])
  assert.deepEqual(shotCombos('3d', [], ['F.Cu']), [{ layer: 'F.Cu' }], 'one layer keeps its old file name')
  assert.deepEqual(shotCombos('2d', [], []), [{}])
  const files = shotJobs([{ name: 'B', targets: [null] }], ['2d', '3d'], '/o', { select: ['U1', 'Q1'], layer: ['F.Cu', 'B.Cu'] }).map(j => j.file)
  assert.deepEqual(files, ['/o/B-2d-select-U1-F.Cu.png', '/o/B-2d-select-U1-B.Cu.png', '/o/B-2d-select-Q1-F.Cu.png', '/o/B-2d-select-Q1-B.Cu.png', '/o/B-3d-select-U1.png', '/o/B-3d-select-Q1.png'])
})

// ---- a dev server of the project answers ----
let w, server, base
before(async () => {
  w = makeStack()
  server = await dev({ root: w.a, port: 0, host: '127.0.0.1' })
  server.config.logger.info = () => {}
  base = `http://127.0.0.1:${server.httpServer.address().port}`
  await fetch(`${base}/__pcbjs/board.json`)
})
after(async () => {
  await server?.close()
  if (w) rmSync(w.root, { recursive: true, force: true })
})

test('dev reuse: /__pcbjs/cli/board says whether the board of an entry is current', async () => {
  const entry = realpathSync(join(w.a, 'pcb.tsx'))
  const b = await (await fetch(`${base}/__pcbjs/cli/board?entry=${encodeURIComponent(entry)}`)).json()
  assert.equal(b.current, true)
  assert.deepEqual([b.name, b.targets, b.refs, b.route, b.displayed], ['A', [null], ['TP1', 'TP2'], '/', true])
  const none = await (await fetch(`${base}/__pcbjs/cli/board?entry=/nope.tsx`)).json()
  assert.deepEqual(none, { current: false, reason: 'no such entry on this server' })
})

test('dev reuse: inspect with several queries answers from the dev server in one line, and --fresh compiles here', async () => {
  const r = await run(w.a, 'inspect', 'TP1', 'V', '--lengths', 'V')
  // the board has a track and no route: that one answer is not found, so the run exits with 1 after printing all
  assert.equal(r.code, 1, r.stderr)
  assert.match(r.stderr, new RegExp(`^dev server  ${base}/  pcb\\.tsx current, compiled .* ago in .*; --fresh compiles here$`, 'm'))
  assert.doesNotMatch(r.stderr, /^compiled /m)
  assert.match(r.stdout, /^A 1  pcb\.tsx  mm/)
  assert.match(r.stdout, /^== TP1\nTP1  V  /m)
  assert.match(r.stdout, /^== V\nnet V  2 pads/m)
  assert.match(r.stdout, /^== --lengths V\nno route of the net, pair or group V$/m)
  const f = await run(w.a, 'inspect', 'TP1', '--fresh')
  assert.equal(f.code, 0, f.stderr)
  assert.match(f.stderr, /^compiled  pcb\.tsx  \d/m)
  assert.doesNotMatch(f.stderr, /dev server/)
})

test('dev reuse: an edit just made is compiled first, so the answer is never older than the files', async () => {
  writeFileSync(join(w.a, 'pcb.tsx'), stackBoard('A', '7'))
  const r = await run(w.a, 'inspect', 'TP1')
  assert.match(r.stderr, /^dev server  /m)
  assert.match(r.stdout, /^A 7  pcb\.tsx  /)
})

test('dev reuse: without a live dev server inspect compiles itself', async () => {
  await server.close()
  server = null
  assert.ok(!existsSync(join(w.a, '.pcbjs', 'dev.json')))
  const r = await run(w.a, 'inspect', 'TP1', 'TP2')
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /^compiled  pcb\.tsx  /m)
  assert.match(r.stdout, /^== TP2$/m)
})
