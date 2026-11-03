// The board selector: the page switches to the chosen board, and with an editor attached it asks the session through the edit
// client to open the board's entry, `session/select` with the board reference alone; a page without an editor only switches.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fixture } from './fixture-board.mjs'
import { facetSet } from '@pcbjs/core/site-facets'

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
const { editClient } = await import('../src/edit-client.ts')
const { fakeTransport } = await import('./fake-transport.mjs')

/** A page of Fx and Gx, Gx with two targets, with a fake session behind its edit client, answering each request at once. */
function page(editor) {
  const store = createViewer({
    boards: [fixture(), ...['house', 'fab'].map(t => ({ ...fixture(), name: 'Gx', title: 'Gx', variant: { name: t } }))].map(facetSet),
    single: false,
    path: '/board/Fx',
    baseUrl: '/',
  })
  const t = fakeTransport()
  store.edit.client = editClient(t)
  store.edit.mode = { mode: 'rw', editor }
  return { store, sent: t.sent }
}

test('with an editor attached a board choice switches the page and opens the entry once, for a board of several targets too', () => {
  const { store, sent } = page(true)
  assert.equal(store.current.value.name, 'Fx')
  store.chooseBoard('Gx')
  assert.equal(store.current.value.name, 'Gx')
  assert.equal(store.currentGroup.value.targets.length, 2)
  assert.deepEqual(sent, [['session/select', { board: 'Gx', refs: ['board:Gx'] }]])
})

test('a page without an editor keeps the switch alone', () => {
  const { store, sent } = page(false)
  store.chooseBoard('Gx')
  assert.equal(store.current.value.name, 'Gx')
  assert.deepEqual(sent, [])
})

test('host selection chooses its explicit first target before selecting, and rejects stale targets', async () => {
  const { store } = page(false)
  store.chooseBoard('Gx')
  store.selectTarget('Gx', 'fab')
  assert.equal(store.current.value.variant.name, 'fab')
  await store.applyRequest({ kind: 'select', board: 'Gx', target: null, refs: ['R1'], frame: false, by: 'tree' })
  assert.equal(store.current.value.variant.name, 'house')
  assert.equal(store.board('Gx').sel.anchor, 'R1')
  store.selectTarget('Gx', 'fab')
  await store.applyRequest({ kind: 'select', board: 'Gx', target: 'missing', refs: ['D1'], frame: false, by: 'tree' })
  assert.equal(store.current.value.variant.name, 'fab')
  assert.match(store.page.toast.text, /Board action unavailable/ )
  assert.equal(store.board('Gx').sel.anchor, 'R1')
  await store.applyRequest({ kind: 'select', board: 'missing', target: null, refs: ['D1'], frame: false, by: 'tree' })
  assert.equal(store.current.value.name, 'Gx')
  assert.equal(store.board('Gx').sel.anchor, 'R1')
})

 test('host target-only navigation preserves the current view', async () => {
  const { store } = page(false)
  store.chooseBoard('Gx')
  store.selectTarget('Gx', 'fab')
  store.pane('Gx').mode = '3d'
  await store.applyRequest({ kind: 'view', board: 'Gx', target: null, view: null, side: null, mirror: null })
  assert.equal(store.current.value.variant.name, 'house')
  assert.equal(store.pane('Gx').mode, '3d')
})

test('canonical target replay reconciles an explicit target route before applying focus', async () => {
  const { createSync } = await import('../src/sync.ts')
  const { store } = page(false), sent = []
  store.chooseBoard('Gx')
  store.selectTarget('Gx', 'house')
  assert.equal(store.current.value.variant.name, 'house')
  const b = store.board('Gx')
  const relay = createSync({ select: m => sent.push(m), hover() {} }, cb => cb())
  const selection = relay.receive({ board: 'Gx', selection: { ...b.sel, target: 'fab', refs: ['R1'], anchor: 'R1', seq: 5 } })
  store.selectTarget('Gx', selection.target)
  b.takeSel(selection)
  await new Promise(r => setTimeout(r, 0))
  assert.equal(store.current.value.variant.name, 'fab')
  assert.equal(b.site.variant.name, 'fab')
  assert.equal(b.sel.target, 'fab')
  assert.equal(store.observing().target, 'fab')
  relay.select('Gx', b.sel)
  assert.deepEqual(sent, [])
  store.stop()
})
