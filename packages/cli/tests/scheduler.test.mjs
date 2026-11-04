// The tiers as a pure scheduler, driven by a fake clock and a fake compiler that runs each job it is handed: a burst of keys gets
// a sketch per key and one compile after the quiet period, a held text compiles nothing until it is released, a query in the middle
// of a burst takes the edits so far at once, and a demand for views a board lacks compiles them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GATHER_MS, isRun, scheduler, tiers } from '../dist/session/scheduler.js'

const TIERS = tiers({ keystroke: 30, quiet: 300 })
const A = '/p/a.pcb.tsx'
const B = '/p/b.pcb.tsx'
const edit = (file, slots, typed) => ({ file, slots, typed })

/** A fake compiler: each run it is handed ends `ms` later, finishing its slots, those only `held` files reach left waiting, `partial` those it compiles for some views; the clock steps 10 ms. */
function harness(slots, { ms = 100, held = new Set(), partial = () => null } = {}) {
  const s = scheduler(slots, TIERS)
  const log = []
  let now = 0
  let ends = null
  const step = to => {
    for (; now <= to; now += 10) {
      if (ends && ends.at <= now) {
        s.done(ends.run, ends.result)
        ends = null
      }
      for (let job = s.next(now); job; job = s.next(now)) {
        log.push({ at: now, job })
        if (!isRun(job)) continue
        const typed = new Set(job.edits.filter(e => e.typed && held.has(e.file)).map(e => e.file))
        const need = new Set([...job.wanted, ...job.edits.filter(e => !typed.has(e.file)).flatMap(e => e.slots)])
        const compiled = job.slots.filter(x => need.has(x))
        const parts = new Map(compiled.flatMap(x => (partial(x, job) ? [[x, new Set(partial(x, job))]] : [])))
        ends = { at: now + ms, run: job, result: { left: [], partial: parts }, compiled }
        log.at(-1).compiled = compiled
      }
    }
    now = to + 10
  }
  return { s, log, step, now: () => now, runs: () => log.filter(l => isRun(l.job)), sketches: () => log.filter(l => !isRun(l.job)) }
}

test('a burst of ten keys 50 ms apart: each sketch starts immediately, one compile 300 ms after the last', () => {
  const h = harness([A])
  h.s.demand(new Map([[A, ['meta', 'layers']]]), 0)
  for (let i = 0; i < 10; i++) {
    h.step(i * 50 - 10)
    assert.equal(h.s.edit(edit(A, [A], true), i * 50), false, 'nothing runs to stop')
  }
  h.step(2000)
  assert.deepEqual(
    h.sketches().map(l => l.at),
    [0, 50, 100, 150, 200, 250, 300, 350, 400, 450],
  )
  assert.equal(h.runs().length, 1)
  const [run] = h.runs()
  assert.equal(run.at, 450 + 300)
  assert.equal(run.job.tier.name, 'quiet')
  assert.deepEqual(run.job.views.get(A), ['meta', 'layers'])
  assert.deepEqual(run.job.edits, [edit(A, [A], true)])
  assert.equal(h.s.busy(), false)
})

test('continuous typing coalesces sketches without postponing them until the burst ends', () => {
  const s = scheduler([A], TIERS)
  s.demand(new Map([[A, ['layers']]]), 0)
  const sketches = []
  for (let now = 0; now <= 100; now += 10) {
    s.edit(edit(A, [A], true), now)
    const job = s.next(now)
    if (job) {
      assert.equal(isRun(job), false)
      sketches.push(now)
    }
  }
  assert.deepEqual(sketches, [0, 30, 60, 90])
  assert.equal(s.due(), 120, 'the trailing edit still gets a sketch')
  assert.equal(s.next(120).file, A)
  assert.equal(s.due(), 400, 'full compile still waits for typing quiet')
})

test('an edit while a run runs stops it, and the next run waits for it to end', () => {
  const h = harness([A], { ms: 200 })
  h.s.demand(new Map([[A, null]]), 0)
  h.s.edit(edit(A, [A], false), 0)
  h.step(GATHER_MS + 50)
  assert.equal(h.runs().length, 1)
  assert.equal(h.s.edit(edit(A, [A], false), 120), true, 'the running compile stops')
  h.step(1000)
  const [a, b] = h.runs()
  assert.equal(a.at, GATHER_MS)
  assert.equal(b.at, a.at + 200, 'the second starts as the first ends, past its own gather')
})

test('a held text compiles nothing and waits; released, its file compiles after the gather alone', () => {
  const h = harness([A], { held: new Set([A]) })
  h.s.demand(new Map([[A, ['layers']]]), 0)
  h.s.edit(edit(A, [A], true), 0)
  h.step(1000)
  assert.equal(h.runs().length, 1)
  assert.deepEqual(h.runs()[0].compiled, [], 'the hold keeps its slot from compiling')
  assert.equal(h.s.due(), null, 'nothing waits')
  // the cursor left the block: the text applies, a write like any other
  h.s.edit(edit(A, [A], false), 1100)
  h.step(2000)
  const last = h.runs().at(-1)
  assert.equal(last.at, 1100 + GATHER_MS)
  assert.deepEqual(last.compiled, [A])
})

test('a query in the middle of a burst compiles every view of the edits so far at once, and the quiet run it took does not follow', () => {
  const h = harness([A, B])
  h.s.demand(new Map([[A, ['layers']]]), 0)
  h.s.edit(edit(A, [A], true), 0)
  h.s.edit(edit(A, [A], true), 50)
  h.step(90)
  h.s.query()
  h.step(1000)
  const runs = h.runs()
  assert.equal(runs.length, 1, runs.map(r => `${r.job.tier.name}@${r.at}`).join(' '))
  assert.equal(runs[0].at, 100)
  assert.equal(runs[0].job.tier.name, 'query')
  assert.deepEqual(runs[0].job.slots, [A, B], 'every slot never compiled comes too')
  assert.equal(runs[0].job.views.get(A), null, 'every view')
  // typing on after the query: the quiet tier again
  h.s.edit(edit(A, [A], true), 1100)
  h.step(2000)
  assert.equal(h.runs().at(-1).job.tier.name, 'quiet')
  assert.equal(h.runs().at(-1).at, 1400)
})

test('a demand for views a board lacks compiles them; a board no one observes goes stale until one does', () => {
  const h = harness([A, B], { partial: (x, job) => (x === A && job.tier.name === 'quiet' ? ['meta', 'sch'] : null) })
  h.s.query()
  h.step(200)
  h.s.demand(new Map([[A, ['meta', 'sch']]]), 300)
  h.s.edit(edit(null, [A, B], false), 300)
  h.step(1000)
  const quiet = h.runs().at(-1)
  assert.deepEqual(quiet.job.slots, [A], 'B has no observer')
  assert.deepEqual([...h.s.unseen().keys()].sort(), [A, B])
  assert.deepEqual([...h.s.unseen().get(A)], ['meta', 'sch'])
  assert.deepEqual([...h.s.unseen().get(B)], [])
  // the same views again: nothing to do
  h.s.demand(new Map([[A, ['meta', 'sch']]]), 1100)
  h.step(1500)
  assert.equal(h.runs().length, 2)
  // a pane on B, and A's pane switches to 2D
  h.s.demand(
    new Map([
      [A, ['meta', 'layers']],
      [B, null],
    ]),
    1600,
  )
  h.step(2000)
  const more = h.runs().at(-1)
  assert.equal(more.at, 1600 + GATHER_MS)
  assert.deepEqual(more.job.wanted, [A, B])
  assert.deepEqual(more.job.views.get(A), ['meta', 'layers'])
  assert.equal(more.job.views.get(B), null)
})
