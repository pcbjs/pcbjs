// A facet is encoded once however many viewers take it: each connection's frame is the shared body with its own seq spliced in, and a
// held facet a later run keeps is a new message, so its frame names that run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientsOf } from '../dist/session/clients.js'
import { facetFrame, facetStore } from '../dist/session/facet-store.js'

const clients = () => clientsOf({ info: () => ({ session: 's', edit: 'localhost' }), ready: () => null, hub: () => null, methods: () => undefined, log: () => {} })

/** A connection that keeps each frame as the bytes it would write. */
function wire(all) {
  const frames = []
  const c = all.add({
    kind: 'tcp',
    loopback: true,
    send: (head, tail) => frames.push(tail ? Buffer.concat([Buffer.from(head), tail]).toString() : head),
    close() {},
  })
  return { c, frames: () => frames.map(f => JSON.parse(f)) }
}

const facet = { board: 'B', facet: 'layers', stage: 'place', hash: 'h1', run: 3, data: { layers: [{ id: 'F.Cu', svg: '<path d="M0 0"/>' }] } }

test('one encoding, every connection its own seq', () => {
  const all = clients()
  const a = wire(all),
    b = wire(all)
  b.c.event('pcbjs:status', { phase: 'idle' })
  const e = facetFrame(facet)
  assert.equal(facetFrame(facet), e, 'the same message is encoded once')
  a.c.post(e)
  b.c.post(e)
  assert.deepEqual(a.frames(), [{ seq: 1, event: 'pcbjs:facet', data: facet }])
  assert.deepEqual(b.frames()[1], { seq: 2, event: 'pcbjs:facet', data: facet })
})

test('cached reconciliation retains current facets without resending unchanged content', () => {
  const store = facetStore()
  store.put(facet)
  const site = { name: 'B', layers: [], items: [] }
  const emitted = store.reconcile({ site, hashes: { layers: 'h1' } }, 7)
  assert.deepEqual(emitted, [], 'a successful cached compile need not stream a new facet')
  const observing = { board: 'B', target: null, facets: ['layers'] }
  assert.deepEqual(store.lacking('B', null, observing, { layers: 'h1' }, false), [], 'the current viewer retains matching content')
  const [held] = store.lacking('B', null, observing, {}, false)
  assert.deepEqual(held.data, facet.data, 'a late viewer receives the retained geometry')
  assert.equal(held.run, 7)
  assert.equal(JSON.parse('{' + facetFrame(held).tail).data.run, 7)
  assert.equal(facet.run, 3, 'the message first encoded is never changed')
})
