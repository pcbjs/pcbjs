import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, reactive, nextTick } from 'vue'
import { connectLibrary } from '../src/layout.ts'

test('library preview reports unsupported servers without issuing a request, then loads after negotiation', async () => {
  const scope = effectScope(),
    events = new Map()
  let calls = 0
  const b = reactive({ name: 'B', sel: { isolate: null }, target: null, run: 1, libraryN: 0, library: null, libraryState: 'idle', libraryError: null })
  scope.run(() => connectLibrary({ on: (event, fn) => events.set(event, fn), request: async () => (++calls, { name: 'template' }) }, () => b))
  events.get('pcbjs:ide:ready')({ capabilities: [] })
  b.sel.isolate = { ref: 'CH1', mode: 'library' }
  await nextTick()
  assert.equal(b.libraryState, 'unsupported')
  assert.match(b.libraryError, /Update.*restart/)
  assert.equal(calls, 0)
  events.get('pcbjs:ide:ready')({ capabilities: ['layout'] })
  await nextTick()
  await nextTick()
  assert.equal(b.libraryState, 'ready')
  assert.equal(calls, 1)
  assert.equal(b.library.site.name, 'template')
  scope.stop()
})
