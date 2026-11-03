// The store holds boards as plain data, never as deep proxies, whether they came with the page, whole in `pcbjs:boards` or joined
// from facets, while the list of boards stays reactive so a new board or a replaced one still renders.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { computed, isReactive } from 'vue'
import { fixture } from './fixture-board.mjs'
import { facetHash, facetSet, splitSite } from '@pcbjs/core/site-facets'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { createViewer } = await import('../src/shell.ts')

const page = () => createViewer({ boards: [facetSet(fixture())], single: true, path: '/', baseUrl: '/' })

test('a board the page came with is plain data', () => {
  const store = page()
  assert.equal(store.current.value.name, 'Fx')
  assert.equal(isReactive(store.current.value), false)
  assert.equal(isReactive(store.current.value.items), false)
})

test('a board joined from facets is plain data, and the list still updates', () => {
  const store = page()
  const seen = computed(() => store.current.value)
  const before = seen.value
  const parts = splitSite({ ...fixture(), title: 'next' })
  for (const facet of ['meta', 'layers']) store.take({ board: 'Fx', run: 2, facet, stage: 'place', hash: facetHash(parts[facet]), data: parts[facet] })
  assert.notEqual(seen.value, before, 'the computed sees the new board')
  assert.equal(seen.value.title, 'next')
  assert.equal(isReactive(seen.value), false)
  assert.equal(isReactive(store.board('Fx').held.get('Fx').facets.layers.data), false)
  assert.equal(isReactive(store.board('Fx').site), false)
})

test('a board that came whole in pcbjs:boards is plain data', () => {
  const store = page()
  store.takeBoards({ boards: [facetSet({ ...fixture(), generatedAt: 'later' })], single: true, errors: {}, run: 3 })
  assert.equal(store.current.value.generatedAt, 'later')
  assert.equal(isReactive(store.current.value), false)
})
