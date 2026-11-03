// The route end assist in the views on a fixture: the context shown only for its board in a read-write dev viewer, the copper of the
// open ends and the first end kept by the isolation that fades the rest, the ratsnest of the first end's net lit and the other lines
// dimmed, the status, the 2D marks and labels, the 3D labels on their side's copper, the end under the pointer, and a pick.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fixture } from './fixture-board.mjs'

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
const { applyEndFocus, endIds, endIso, endLines, endMarks2d, endMarks3d, endStatus, endsOf, litEnd, nearestEnd, padIds, pickEnd } = await import('../src/ends.ts')

/** The fixture with B open between R1/2 and R2/1, and GND open too. */
const site = () => ({
  ...fixture(),
  dev: true,
  ratsnest: [
    { net: 'B', from: [1.5, 5], to: [4.5, 5] },
    { net: 'GND', from: [5.5, 5], to: [11.5, 5] },
  ],
})
/** `route(R1[2], |)`: the one open end on B, R2/1, as the language server names it, and CH1's bound route end, on B here too. */
const ctx = () => {
  const s = site()
  const pad = (ref, num, handle) => {
    const p = s.footprints.find(f => f.ref === ref).pads.find(x => x.num === num)
    return { handle, label: `${num} ${p.name} · ${p.net}`, kind: 'pad', ref: `${ref}/${num}`, num, name: p.name, net: p.net, at: p.at, side: 'F' }
  }
  return {
    board: 'Fx',
    command: 'end',
    relative: false,
    ref: null,
    start: [1.5, 5],
    pad: 'R1/2',
    layer: 'F.Cu',
    net: 'B',
    side: 'F',
    grid: null,
    width: null,
    typed: [],
    open: false,
    ends: {
      slot: 1,
      append: false,
      net: 'B',
      candidates: [pad('R2', '1', 'G.R2[1]'), { handle: 'CH1.trunk.end', label: 'end · B', kind: 'point', ref: 'route:1/pt:1', net: 'B', at: [11, 7], side: 'B' }],
    },
  }
}

test('ends: shown for its board in a read-write dev viewer only, and not for a chain call', () => {
  const s = site()
  const t = { assist: ctx(), assistOff: false, mode: { mode: 'rw' } }
  assert.equal(endsOf(t, s)?.ends.slot, 1)
  assert.equal(endsOf({ ...t, mode: { mode: 'ro' } }, s), null)
  assert.equal(endsOf({ ...t, assistOff: true }, s), null)
  assert.equal(endsOf(t, { ...s, name: 'Other' }), null)
  assert.equal(endsOf(t, { ...s, dev: false }), null)
  assert.equal(endsOf({ ...t, assist: { ...ctx(), command: 'H', ends: undefined } }, s), null)
})

test('ends: the isolation keeps the open ends and the first end, fading everything else; the ratsnest of B lit, GND dimmed', () => {
  const s = site()
  assert.deepEqual(padIds(s).get('R2/1'), [3])
  assert.deepEqual(endIds(s, ctx()).sort(), [2, 3, 9])
  const iso = endIso(s, ctx())
  assert.equal(iso.fade, true)
  assert.deepEqual([...iso.ids].sort(), [2, 3, 9])
  assert.equal(iso.parts.size, 0)
  assert.deepEqual(
    endLines(s, ctx()).map(l => [l.net, l.lit]),
    [
      ['B', true],
      ['GND', false],
    ],
  )
  const first = { ...ctx(), pad: null, ends: { ...ctx().ends, slot: 0, net: null } }
  assert.ok(
    endLines(s, first).every(l => l.lit),
    'the first slot lights every open line',
  )
  assert.equal(endStatus(ctx()), '2 open ends on B')
  assert.equal(endStatus({ ...ctx(), ends: { ...ctx().ends, notes: ['CH3 is not in scope here'] } }), '2 open ends on B · CH3 is not in scope here')
  assert.equal(endStatus({ ...first, ends: { ...first.ends, candidates: [first.ends.candidates[0]] } }), '1 open end')
})

test('ends: the 2D annotation set, a ring and a label per open end, each label off its part, mirrored back in a mirrored view', () => {
  const marks = endMarks2d(ctx(), 0.05)
  assert.deepEqual(
    marks.map(m => [m.handle, m.label]),
    [
      ['G.R2[1]', '1 A · B'],
      ['CH1.trunk.end', 'end · B'],
    ],
  )
  const r2 = marks[0]
  assert.deepEqual(r2.at, [4.5, 5])
  assert.deepEqual(r2.text, [4.5 + 0.4, 5 + r2.size * 0.35])
  assert.equal(r2.anchor, 'start')
  assert.equal(r2.transform, undefined)
  const flipped = endMarks2d(ctx(), 0.05, true)[0]
  assert.equal(flipped.transform, `matrix(-1 0 0 1 ${2 * (4.5 + 0.4)} 0)`)
  assert.equal(flipped.anchor, 'end')
  // R2/1 is left of R2's origin, so its label goes left of the pad, anchored at its end
  const placed = endMarks2d(ctx(), 0.05, false, site())[0]
  assert.deepEqual([placed.text, placed.anchor], [[4.5 - 0.4, 5 + placed.size * 0.35], 'end'])
})

test('ends: the 3D annotation set, on the front copper or under the back, y up', () => {
  assert.deepEqual(endMarks3d(ctx(), { F: 1.6, B: 0 }), [
    { handle: 'G.R2[1]', label: '1 A · B', side: 'F', at: [4.5, -5, 1.6] },
    { handle: 'CH1.trunk.end', label: 'end · B', side: 'B', at: [11, -7, 0] },
  ])
})

test('ends: the completion focus lights its end as a hover does, the pointer winning, following the list and clearing per board', () => {
  const t = { assist: ctx(), assistOff: false, mode: { mode: 'rw' }, endFocus: null }
  assert.equal(litEnd(t, ctx(), null), null)
  t.endFocus = applyEndFocus(t.endFocus, { board: 'Fx', handle: 'G.R2[1]' })
  assert.equal(litEnd(t, ctx(), null).handle, 'G.R2[1]')
  t.endFocus = applyEndFocus(t.endFocus, { board: 'Fx', handle: 'CH1.trunk.end' })
  assert.equal(litEnd(t, ctx(), null).handle, 'CH1.trunk.end', 'it follows the arrow keys')
  assert.equal(litEnd(t, ctx(), ctx().ends.candidates[0]).handle, 'G.R2[1]', 'the pointer wins')
  assert.equal(litEnd({ ...t, endFocus: { board: 'Other', handle: 'G.R2[1]' } }, ctx(), null), null)
  assert.equal(litEnd({ ...t, endFocus: { board: 'Fx', handle: 'Z9[1]' } }, ctx(), null), null, 'a handle the slot does not offer lights nothing')
  assert.deepEqual(applyEndFocus(t.endFocus, { board: 'Other', handle: null }), t.endFocus, 'another board clearing keeps this one')
  t.endFocus = applyEndFocus(t.endFocus, { board: 'Fx', handle: null })
  assert.equal(t.endFocus, null)
  const marks = endMarks2d(ctx(), 0.05)
  assert.equal(marks.length, 2, 'the other candidates stay as they are')
})

test('ends: the end under the pointer, and a pick that writes its handle through the edit client', async () => {
  assert.equal(nearestEnd(ctx(), [4.6, 5.1], 0.5)?.handle, 'G.R2[1]')
  assert.equal(nearestEnd(ctx(), [7, 7], 0.5), null)
  const calls = []
  const client = {
    begin: async p => (calls.push(['begin', p]), { txn: 'edit1', tools: [] }),
    update: async (txn, u) => (calls.push(['update', txn, u]), { files: [{ file: '/p/pcb.tsx', edits: [] }], notes: ['writes pcb.tsx:9'] }),
    commit: async txn => (calls.push(['commit', txn]), { written: [{ file: '/p/pcb.tsx', via: 'editor', applied: true }] }),
    cancel: async txn => calls.push(['cancel', txn]),
  }
  const r = await pickEnd(client, 'Fx', 1, 'G.R2[1]')
  assert.equal(r.written[0].via, 'editor')
  assert.deepEqual(calls, [
    ['begin', { board: 'Fx', run: 1, tool: 'assist', refs: [], anchor: 'assist' }],
    ['update', 'edit1', { end: 'G.R2[1]' }],
    ['commit', 'edit1'],
  ])
  client.update = async () => ({ files: [], notes: ['X9[1] is no end this slot offers'] })
  calls.length = 0
  assert.deepEqual(await pickEnd(client, 'Fx', null, 'X9[1]'), { written: [], error: 'X9[1] is no end this slot offers' })
  assert.deepEqual(calls.at(-1), ['cancel', 'edit1'])
})
