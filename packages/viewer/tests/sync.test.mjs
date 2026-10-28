// Hover and focus shared between viewers: sent once on change, a hover once a frame, and a focus received never sent back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSync, remoteHover } from '../src/sync.ts'

function harness() {
  const sent = [],
    frames = []
  const sync = createSync(
    (event, data) => sent.push({ event, data }),
    cb => frames.push(cb),
  )
  const flush = () => {
    while (frames.length) frames.shift()()
  }
  return { sync, sent, flush }
}
const F = { net: 'GND', ref: 'R1', refs: [], circuit: null }

test('a remote focus is applied without echo, a later local change is sent', () => {
  const { sync, sent } = harness()
  const f = sync.receiveFocus({ board: 'B', focus: F, from: 2 })
  assert.deepEqual(f, F)
  sync.focus('B', { ...f })
  assert.equal(sent.length, 0, 'the change the remote focus caused is not sent back')
  sync.focus('B', { ...F, ref: null })
  sync.focus('B', { ...F, ref: null })
  assert.deepEqual(
    sent.map(m => m.event),
    ['pcbjs:sync:focus'],
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
  const a = { board: 'B', hover: { ids: [1], refs: [], net: null }, from: 1 }
  const b = { board: 'B', hover: { ids: [2], refs: [], net: null }, from: 2 }
  assert.equal(remoteHover(a, b), b)
  assert.equal(remoteHover(b, { board: 'B', hover: null, from: 1 }), b, 'another sender leaving keeps it')
  assert.equal(remoteHover(b, { board: 'B', hover: null, from: 2 }), null)
})
