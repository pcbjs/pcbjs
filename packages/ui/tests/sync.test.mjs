// Hover and the selection shared between viewers: sent once on change with the seq it was based on, a hover once a frame, and a
// selection from the session never sent back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSync, remoteHover } from '../src/sync.ts'

function harness() {
  const sent = [],
    frames = []
  const sync = createSync({ select: data => sent.push({ method: 'session/select', data }), hover: data => sent.push({ method: 'session/hover', data }) }, cb => frames.push(cb))
  const flush = () => {
    while (frames.length) frames.shift()()
  }
  return { sync, sent, flush }
}
const S = { board: 'B', target: null, snapshot: '', refs: ['R1', 'net:GND'], anchor: 'net:GND', level: null, isolate: null, by: 'viewer', client: null, seq: 7 }

test('a selection from the session is applied without echo; a later local change is sent once, based on its seq', () => {
  const { sync, sent } = harness()
  const s = sync.receive({ board: 'B', selection: S })
  assert.deepEqual(s, S)
  sync.select('B', { ...s, by: 'sync', seq: 7 })
  assert.equal(sent.length, 0, 'the change the session selection caused is not sent back')
  sync.select('B', { ...S, refs: ['R1'], anchor: 'R1' })
  sync.select('B', { ...S, refs: ['R1'], anchor: 'R1' })
  assert.deepEqual(
    sent.map(m => [m.method, m.data.base, m.data.selection.refs]),
    [['session/select', 7, ['R1']]],
  )
})

test('hover: one message a frame, the last state of it, and only on change', () => {
  const { sync, sent, flush } = harness()
  const h = id => ({ ids: [id], refs: [], net: null })
  sync.hover('B', h(1))
  sync.hover('B', h(2))
  sync.hover('B', h(3))
  flush()
  assert.deepEqual(
    sent.map(m => m.data.hover.ids[0]),
    [3],
  )
  sync.hover('B', h(3))
  flush()
  assert.equal(sent.length, 1)
  sync.hover('B', null)
  flush()
  assert.equal(sent.at(-1).data.hover, null)
})

test('a remote hover is replaced by its sender and cleared when that sender leaves', () => {
  const a = { board: 'B', hover: { ids: [1], refs: [], net: null }, from: 'c1' }
  const b = { board: 'B', hover: { ids: [2], refs: [], net: null }, from: 'c2' }
  assert.equal(remoteHover(a, b), b)
  assert.equal(remoteHover(b, { board: 'B', hover: null, from: 'c1' }), b, 'another sender leaving keeps it')
  assert.equal(remoteHover(b, { board: 'B', hover: null, from: 'c2' }), null)
})
