// The dev server's loading state: the first load, a recompile that keeps the board, and the server going away.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialLoad, loadBusy, loadName, loadProgress, loadScreenState, loadText, step } from '../src/loading.ts'
import { bootScreen } from '../src/boot-screen.js'

const compiling = (o = {}) => ({ kind: 'status', status: { phase: 'compiling', entry: 'blinky.tsx', name: null, done: 0, total: 1, ...o } })
const routing = (routed, legs, o = {}) => ({ kind: 'status', status: { phase: 'routing', entry: 'blinky.tsx', name: 'Blinky', done: 0, total: 1, routed, legs, ...o } })
const idle = { kind: 'status', status: { phase: 'idle' } }
const run = (s, ...es) => es.reduce(step, s)

test('the first load: starting, compiling, routing with progress, rendering, ready', () => {
  let s = initialLoad()
  assert.equal(s.phase, 'starting')
  assert.equal(loadText(s), 'starting the dev server')
  assert.equal(loadName(s, 'demo'), 'demo')
  s = step(s, compiling({ name: 'Blinky' }))
  assert.equal(loadText(s), 'compiling Blinky')
  assert.equal(loadName(s, 'demo'), 'Blinky')
  assert.equal(loadProgress(s), null, 'one entry and no legs yet: no bar')
  s = step(s, routing(3, 12))
  assert.equal(loadText(s), 'routing 12 legs')
  assert.equal(loadProgress(s), 0.25)
  s = step(s, idle)
  assert.equal(s.phase, 'rendering')
  assert.equal(loadText(s), 'rendering')
  s = step(s, { kind: 'drawn' })
  assert.deepEqual([s.phase, s.shown, loadText(s)], ['ready', true, ''])
})

test('a page served mid-compile starts from the inlined status; one served after it renders', () => {
  assert.equal(initialLoad(compiling({ name: 'Coin' }).status).phase, 'compiling')
  assert.equal(initialLoad({ phase: 'idle' }).phase, 'rendering')
  assert.equal(initialLoad({ phase: 'starting' }).phase, 'starting', 'the server waits for the page before its first compile')
})

test('several entries: the bar counts the entries done and the legs of the current one', () => {
  const s = run(initialLoad(), compiling({ done: 1, total: 4 }))
  assert.equal(loadProgress(s), 0.25)
  assert.equal(loadProgress(step(s, routing(5, 10, { done: 1, total: 4 }))), 0.375)
})

test('a recompile after the first board keeps it shown and comes back to ready', () => {
  const s = run(initialLoad(), idle, { kind: 'drawn' }, compiling({ name: 'Blinky' }))
  assert.deepEqual([s.phase, s.shown], ['compiling', true])
  assert.equal(step(s, { kind: 'drawn' }).phase, 'compiling', 'a redraw mid-compile does not end it')
  assert.equal(step(s, idle).phase, 'ready')
})

test('the server going away counts reconnection attempts and ignores everything else', () => {
  let s = run(initialLoad(), compiling(), { kind: 'lost' })
  assert.equal(loadText(s), 'the dev server stopped')
  assert.equal(loadProgress(s), null)
  s = run(s, { kind: 'retry' }, { kind: 'retry' }, idle, { kind: 'drawn' })
  assert.deepEqual([s.phase, s.attempts], ['gone', 2])
  assert.equal(loadText(s), 'reconnecting, attempt 2')
  assert.equal(step(initialLoad(), { kind: 'retry' }).attempts, 0, 'a retry before the server went means nothing')
})

test('a negotiation round names itself and counts its own legs', () => {
  const s = step(initialLoad(), routing(3, 4, { round: 2 }))
  assert.equal(loadText(s), 'routing 4 legs, round 2')
  assert.equal(loadProgress(s), 0.75)
})

test('the spinner runs while a status is in progress, never on a state at rest', () => {
  const s = initialLoad()
  assert.equal(loadBusy(s), true)
  assert.equal(loadBusy(step(s, compiling())), true)
  assert.equal(loadBusy(step(s, idle)), true, 'rendering')
  assert.equal(loadBusy(run(s, idle, { kind: 'drawn' })), false)
  assert.equal(loadBusy(step(s, { kind: 'lost' })), false)
  assert.equal(loadBusy(step(s, { kind: 'boards', count: 0 })), false)
})

test('no board to show after the server answered: idle, until a compile starts or a board arrives', () => {
  let s = step(initialLoad(), { kind: 'boards', count: 0 })
  assert.deepEqual([s.phase, loadText(s), loadScreenState(s), loadProgress(s)], ['empty', 'Select a board file to get started', 'idle', null])
  assert.equal(step(s, idle).phase, 'empty', 'a compile pass with nothing in it keeps it idle')
  s = step(s, compiling({ name: 'Blinky' }))
  assert.deepEqual([s.phase, loadText(s), loadBusy(s)], ['compiling', 'compiling Blinky', true])
  assert.equal(step(s, { kind: 'boards', count: 0 }).phase, 'compiling', 'an empty list mid-compile is not idle')
  assert.equal(run(initialLoad(), { kind: 'boards', count: 0 }, { kind: 'boards', count: 1 }).phase, 'rendering')
  assert.equal(run(initialLoad(), idle, { kind: 'drawn' }, { kind: 'boards', count: 0 }).phase, 'ready', 'a board once shown stays')
  assert.equal(run(initialLoad(), { kind: 'lost' }, { kind: 'boards', count: 0 }).phase, 'gone')
})

test('loading markup escapes messages and exposes busy state', () => {
  const html = bootScreen({ mark: '<svg></svg>', name: 'demo', text: 'compiling <x>', busy: true })
  assert.ok(html.includes('compiling &lt;x&gt;'))
  assert.ok(html.includes('data-busy'))
  assert.ok(!bootScreen({ mark: '', state: 'idle' }).includes('data-busy'))
})
