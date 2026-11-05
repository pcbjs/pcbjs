import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventFeed, CLAIM_MS, HOOK_CLAIM_MS } from '../dist/session/feed.js'

test('hook lifecycle waits for delayed spawned claims through compile flush, then bounds unclaimed writes', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const events = [],
    shadows = [],
    by = { client: 'agent', name: 'claude-code', role: 'agent', task: 'claimed edits' }
  const feed = eventFeed({ projectOf: () => '/project', disk: () => 'source', log: () => ({ push: (...args) => events.push(args) }) })
  try {
    feed.expectClaims()
    feed.written('/project/a.tsx')
    feed.shadowed('/project/a.tsx', actor => shadows.push(actor))
    t.mock.timers.tick(CLAIM_MS + 500)
    feed.flush()
    assert.equal(events.length, 0)
    assert.deepEqual(shadows, [])
    feed.claim('/project/a.tsx', by)
    assert.equal(events.length, 1)
    assert.equal(events[0][2].source, 'agent')
    assert.equal(events[0][3], by)
    assert.deepEqual(shadows, [by])
    feed.written('/project/unclaimed.tsx')
    t.mock.timers.tick(HOOK_CLAIM_MS)
    assert.equal(events.length, 2)
    assert.equal(events[1][2].source, 'disk')
    assert.equal(events[1][3], null)
  } finally {
    feed.dispose()
    t.mock.timers.reset()
  }
})

test('ordinary feeds retain their short coalescing and direct-claim wait', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 })
  const events = [],
    by = { client: 'agent', name: 'agent', role: 'agent' }
  const feed = eventFeed({ projectOf: () => '/project', disk: () => 'source', log: () => ({ push: (...args) => events.push(args) }) })
  try {
    feed.written('/project/ordinary.tsx')
    t.mock.timers.tick(200)
    assert.equal(events.length, 1)
    feed.claim('/project/claimed.tsx', by)
    feed.written('/project/unclaimed.tsx')
    t.mock.timers.tick(CLAIM_MS)
    assert.equal(events.length, 2)
    assert.equal(events[1][2].source, 'disk')
  } finally {
    feed.dispose()
    t.mock.timers.reset()
  }
})
