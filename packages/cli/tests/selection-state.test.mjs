import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptySelection, sameSelection } from '@pcbjs/core/internal/selection'
import { selectionStore } from '../dist/session/selection.js'

test('target and snapshot identity survive set, offer and replay', () => {
  const st = selectionStore(), client = {}, a = emptySelection('B')
  st.set('B', { refs: ['R1'], anchor: 'R1', finding: 'drc:a' }, 'viewer', null)
  const changed = st.set('B', { target: 'Other', snapshot: 'session.2' }, 'viewer', null)
  assert.equal(changed.target, 'Other')
  assert.equal(changed.finding, 'drc:a')
  assert.equal(sameSelection(a, { ...a, target: 'Other' }), false)
  assert.equal(sameSelection(a, { ...a, snapshot: 'session.2' }), false)
  assert.equal(st.offer(client, { board: 'B', selection: changed }, null), null)
  assert.equal(st.offer(client, { board: 'B', selection: { ...changed, snapshot: 'session.3' } }, null).snapshot, 'session.3')
})

test('entity focus, unrelated selection and explicit empty clear share normalization', () => {
  const st = selectionStore(() => [{ id: 'drc:a', refs: ['R1/1'] }]), client = {}
  const finding = { ...emptySelection('B'), finding: 'drc:a', refs: ['drc:a'], anchor: 'drc:a' }
  st.offer(client, { board: 'B', selection: finding }, null)
  assert.equal(st.offer(client, { board: 'B', selection: { ...finding, refs: ['R1', 'R1'], anchor: 'R1' } }, null).finding, 'drc:a')
  assert.equal(st.set('B', { refs: ['R2'], anchor: 'R2' }, 'editor', null).finding, null)
  st.offer(client, { board: 'B', selection: finding }, null)
  assert.equal(st.offer(client, { board: 'B', selection: { ...finding, refs: ['R2'], anchor: 'R2' } }, null).finding, null)
  st.offer(client, { board: 'B', selection: finding }, null)
  assert.equal(st.set('B', { refs: [], anchor: null }, 'agent', null).finding, null)
})

test('malformed wire selections and bases cannot mutate canonical state', () => {
  const st = selectionStore(), a = emptySelection('B')
  for (const bad of [{ refs: [3] }, { target: {} }, { marks: { points: [[NaN, 1]] } }, { isolate: {} }, { board: 'Other' }, { anchor: {} }]) {
    assert.throws(() => st.offer({}, { board: 'B', selection: { ...a, ...bad } }, null), /invalid selection/)
    assert.equal(st.get('B'), null)
  }
  assert.throws(() => st.offer({}, { board: 'B', selection: a, base: -1 }, null), /invalid selection/)
})


test('editor blur and viewer deselection dismiss instance layout in canonical selection', () => {
  for (const source of ['editor', 'viewer']) {
    const store = selectionStore(), client = {}
    const focused = { ...emptySelection('B'), refs: ['CH1/R1'], anchor: 'CH1/R1', level: 'CH1', isolate: { ref: 'CH1', context: 'CH1', instances: ['CH1'], preview: false, mode: 'instance' } }
    store.offer(client, { board: 'B', selection: focused }, null)
    const next = source === 'editor' ? store.set('B', { refs: [], anchor: null }, 'editor', null) : store.offer(client, { board: 'B', selection: { ...focused, refs: [], anchor: null } }, null)
    assert.deepEqual([next.refs, next.anchor, next.isolate, next.level, next.isolateChoice], [[], null, null, null, null])
    assert.equal(store.get('B'), next)
    assert.equal(store.offer({}, { board: 'B', selection: next }, null), null, 'other viewers replay the dismissed context without echo')
  }
})
