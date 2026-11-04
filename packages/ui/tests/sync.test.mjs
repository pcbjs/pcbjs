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

test('rejection restores authoritative selection without echo, but never rolls back a newer intent', () => {
  const { sync, sent } = harness()
  sync.receive({ board: 'B', selection: S })
  sync.select('B', { ...S, refs: ['R2'], anchor: 'R2' })
  const rejected = sent.at(-1).data
  assert.equal(sync.reject(rejected), S)
  sync.select('B', S)
  assert.equal(sent.length, 1)
  sync.select('B', rejected.selection)
  sync.select('B', { ...S, refs: ['R3'], anchor: 'R3' })
  assert.equal(sync.reject(rejected), null)
  const remote = { ...S, seq: 8 }
  sync.receive({ board: 'B', selection: remote })
  assert.equal(sync.reject(sent.at(-1).data), remote)
  sync.reset()
  sync.select('C', { ...S, board: 'C' })
  assert.deepEqual(sync.reject(sent.at(-1).data).refs, [])
})

test('delayed acknowledgments keep the newest local focus and its toolbar state', () => {
  const { sync, sent } = harness()
  sync.receive({ board: 'B', selection: S })
  const group = { ...S, refs: ['CH1'], anchor: 'CH1' }
  const part = { ...S, refs: ['CH1/R1'], anchor: 'CH1/R1' }
  sync.select('B', group)
  sync.select('B', part)
  const first = { ...group, seq: 8 },
    second = { ...part, seq: 9 }
  assert.equal(sync.receive({ board: 'B', selection: first }), part)
  assert.equal(sync.accept(sent[0].data, first), null)
  assert.equal(sync.receive({ board: 'B', selection: second }), part)
  assert.equal(sync.accept(sent[1].data, second), second)
  sync.select('B', second)
  assert.equal(sent.length, 2, 'the final canonical selection is not echoed')
})

test('a newer remote selection wins when the local requests finish', () => {
  const { sync, sent } = harness()
  sync.select('B', S)
  const own = { ...S, seq: 8 },
    remote = { ...S, refs: ['R2'], anchor: 'R2', seq: 9 }
  sync.receive({ board: 'B', selection: own })
  assert.equal(sync.receive({ board: 'B', selection: remote }), S)
  assert.equal(sync.accept(sent[0].data, own), remote)
  assert.equal(sync.receive({ board: 'B', selection: own }), remote, 'an older sequence cannot restore old focus')
})

test('switching boards discards outstanding replies and resets the sequence', () => {
  const { sync, sent } = harness()
  sync.select('B', S)
  const old = sent[0].data
  sync.reset()
  const next = { ...S, board: 'C', seq: 1 }
  assert.equal(sync.receive({ board: 'C', selection: next }), next)
  assert.equal(sync.accept(old, { ...S, seq: 20 }), null)
  sync.select('C', { ...next, anchor: 'R1', refs: ['R1'] })
  assert.equal(sent.at(-1).data.base, 1)
})

test('a reload keeps URL focus when the server already has it and sends no duplicate selection', () => {
  const { sync, sent } = harness()
  sync.select('B', S)
  assert.equal(sync.accept(sent[0].data, null), S)
  sync.select('B', S)
  assert.equal(sent.length, 1)
})
