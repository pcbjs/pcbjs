// The selection contract on a board: a plain click selects the child of the root on the path to the hit, cmd or ctrl the leaf, shift
// toggles, a click inside the selected instance or a double-click enters its definition, Escape goes up and out, the anchor passes back on removal.
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
const { chipPath, click, clickTarget, drawnOf, emptySelection, enter, escape, hitPath, isolate, isolationLabel, isolationView, showInstance, withoutRef } =
  await import('../src/selection.ts')

const B = fixture()
const pad = (id, ref, net) => ({ kind: 'pad', id, ref, net })
const plain = { shift: false, deep: false },
  deep = { shift: false, deep: true },
  shift = { shift: true, deep: false },
  shiftDeep = { shift: true, deep: true }

test('the path of a hit: groups, part and pad; a routed track its instance and route; bare copper its item; a pour its plane', () => {
  assert.deepEqual(hitPath(B, pad(5, 'R101', 'S1')), ['CH1', 'CH1/R01', 'CH1/R01/1'])
  assert.deepEqual(hitPath(B, pad(2, 'R1', 'B')), ['G', 'G/R1', 'G/R1/2'])
  assert.deepEqual(hitPath(B, { kind: 'body', ref: 'R2' }), ['G', 'G/R2'])
  assert.deepEqual(hitPath(B, { kind: 'track', id: 9, net: 'S1' }), ['CH1', 'route:1'])
  assert.deepEqual(hitPath(B, { kind: 'track', id: 10, net: 'B' }), ['item:00000000000a'])
  assert.deepEqual(hitPath(B, { kind: 'zone', id: 11, net: 'GND' }), ['plane:F.Cu:GND'])
  assert.deepEqual(hitPath(B, { kind: 'pin', ref: 'R201', pad: 'B' }), ['CH2', 'CH2/R01', 'CH2/R01/2'], 'a schematic pin by its name')
  assert.deepEqual(hitPath(B, { kind: 'wire', net: 'S2' }), ['net:S2'])
  assert.deepEqual(hitPath(B, null), [])
})

const isoAt = (sel, ref) => ({ ...sel, isolate: { ref, context: ref, instances: ['CH1', 'CH2'], preview: false }, level: ref })

test('click table: plain, deep, shift and shift+deep on the board and inside an isolated definition', () => {
  const s0 = emptySelection('Fx')
  const h = pad(5, 'R101', 'S1')
  const rows = [
    // isolated instance, modifiers, what a click on CH1/R01 pad 1 selects
    [null, plain, ['CH1']],
    [null, deep, ['CH1/R01/1']],
    ['CH1', plain, ['CH1/R01']],
    ['CH1', deep, ['CH1/R01/1']],
  ]
  for (const [iso, mods, refs] of rows) {
    const s = click(iso ? isoAt(s0, iso) : s0, B, h, mods)
    assert.deepEqual(s.refs, refs, `${iso} ${JSON.stringify(mods)}`)
    assert.equal(s.anchor, refs.at(-1))
    assert.equal(s.isolate?.ref ?? null, iso)
  }
  // shift toggles what a plain click would select, shift+deep the leaf
  let s = click(s0, B, h, plain)
  s = click(s, B, pad(1, 'R1', 'A'), shift)
  assert.deepEqual(s.refs, ['CH1', 'G'])
  assert.equal(s.anchor, 'G')
  s = click(s, B, pad(1, 'R1', 'A'), shift)
  assert.deepEqual(s.refs, ['CH1'], 'shift again takes it out')
  assert.equal(s.anchor, 'CH1')
  assert.equal(click(s, B, h, shift).isolate, null, 'shift on the selected instance toggles it, entering nothing')
  s = click(s, B, h, shiftDeep)
  assert.deepEqual(s.refs, ['CH1/R01/1'], 'a descendant replaces its ancestor, never both')
  // a hit outside the isolated instance selects nothing
  const inside = isoAt(s0, 'CH1')
  assert.equal(click(inside, B, pad(1, 'R1', 'A'), plain), inside)
  // empty board clears and keeps the isolation; with shift it keeps everything
  s = click({ ...isoAt(s0, 'CH1'), refs: ['CH1/R01'], anchor: 'CH1/R01' }, B, null, plain)
  assert.deepEqual([s.refs, s.isolate.ref], [[], 'CH1'])
  const kept = click({ ...s0, refs: ['G'], anchor: 'G' }, B, null, shift)
  assert.deepEqual(kept.refs, ['G'])
  // a click on copper selects its route, the net drawn as context
  s = click(isoAt(s0, 'CH1'), B, { kind: 'track', id: 9, net: 'S1' }, plain)
  assert.deepEqual(s.refs, ['route:1'])
  assert.equal(drawnOf(B, s).context, 'S1')
})

test('a click on an entity of the selected instance enters its definition with the entity selected; a double-click does both', () => {
  const h = pad(5, 'R101', 'S1')
  let s = click(emptySelection('Fx'), B, h, plain)
  assert.deepEqual([s.refs, s.isolate], [['CH1'], null])
  s = click(s, B, h, plain)
  assert.deepEqual(s.isolate, { ref: 'CH1', context: 'CH1', instances: ['CH1', 'CH2'], preview: false })
  assert.deepEqual(s.refs, ['CH1/R01'])
  const d = enter(emptySelection('Fx'), B, h)
  assert.deepEqual([d.isolate.ref, d.refs], ['CH1', ['CH1/R01']], 'the double-click in one gesture')
  // the selected instance's entity is what the hover lights
  assert.equal(clickTarget({ ...emptySelection('Fx'), refs: ['CH1'], anchor: 'CH1' }, B, h, false), 'CH1/R01')
})

test('hover lights what a click would select now, with cmd what a deep-select would', () => {
  const s = emptySelection('Fx')
  const h = pad(7, 'R201', 'S2')
  assert.equal(clickTarget(s, B, h, false), 'CH2')
  assert.equal(clickTarget(s, B, h, true), 'CH2/R01/1')
  assert.equal(clickTarget(isoAt(s, 'CH2'), B, h, false), 'CH2/R01')
  assert.equal(clickTarget(isoAt(s, 'CH1'), B, h, false), null, 'another instance is not in the definition')
  assert.equal(clickTarget(s, B, null, false), null)
})

test('Escape inside an isolation goes up to the root, then leaves to the board with the instance selected, then clears', () => {
  let s = enter(emptySelection('Fx'), B, pad(5, 'R101', 'S1'))
  s = { ...s, refs: ['CH1/R01/1'], anchor: 'CH1/R01/1' }
  s = escape(s, B)
  assert.deepEqual([s.isolate?.ref, s.refs], ['CH1', ['CH1/R01']])
  s = escape(s, B)
  assert.deepEqual([s.isolate, s.level, s.refs], [null, null, ['CH1']])
  s = escape(s, B)
  assert.deepEqual(s.refs, [])
  assert.equal(escape(s, B), s, 'nothing left to leave')
  // on a route inside the definition, the double-click picks the nearest control point
  const r = enter(isoAt(emptySelection('Fx'), 'CH1'), B, { kind: 'track', id: 9, net: 'S1', at: [10.9, 7] })
  assert.deepEqual([r.isolate.ref, r.refs], ['CH1', ['route:1/pt:1']])
  assert.deepEqual(drawnOf(B, r).points, [[11, 7]])
  assert.deepEqual(escape(r, B).refs, ['route:1'])
  assert.deepEqual(escape(escape(r, B), B).refs, ['CH1'])
  // wires and labels the editor's code drew come through as marks, no member
  assert.deepEqual(drawnOf(B, { ...emptySelection('Fx'), marks: { sch: ['wire:2', 'label:0'] } }).sch, ['wire:2', 'label:0'])
})

test('removing the anchor promotes the member before it; the chip path ascends segment by segment', () => {
  const s = { ...emptySelection('Fx'), refs: ['G', 'CH1', 'CH2'], anchor: 'CH2' }
  assert.equal(withoutRef(s, 'CH2').anchor, 'CH1')
  assert.equal(withoutRef(s, 'G').anchor, 'CH2')
  assert.equal(withoutRef({ ...s, anchor: 'G' }, 'G').anchor, 'CH2', 'the first member passes it to the last')
  assert.deepEqual(
    chipPath(B, 'CH1/R01/1').map(c => [c.ref, c.label]),
    [
      ['CH1', 'CH1'],
      ['CH1/R01', 'R01'],
      ['CH1/R01/1', '1'],
    ],
  )
  assert.deepEqual(
    chipPath(B, 'route:1/pt:0').map(c => c.label),
    ['CH1', 'route:1', 'pt:0'],
  )
})

test('Isolate on an instance of two: its definition in its own frame, the board and the other instance hidden, the picker follows, Escape and I leave with the instance selected', () => {
  const F = { ...B, edit: [{ ref: 'CH1', caps: ['placed'], src: {}, m: [1, 0, 0, 1, 0, 0], grid: null, at: [10, 5, 90], frames: [{ inst: 'CH1', m: [0, -1, 1, 0, 10, 5] }] }] }
  let s = click(emptySelection('Fx'), F, pad(5, 'R101', 'S1'), plain)
  s = isolate({ ...s, refs: ['CH1/R01'], anchor: 'CH1/R01' }, F)
  assert.deepEqual(s.isolate, { ref: 'CH1', context: 'CH1', instances: ['CH1', 'CH2'], preview: false })
  assert.deepEqual(s.refs, ['CH1/R01'], 'Isolate on a part inside an instance keeps the part selected')
  const v = isolationView(F, s.isolate)
  assert.deepEqual([...v.parts], ['R101'])
  assert.ok(v.ids.has(5) && v.ids.has(6) && v.ids.has(9), 'its pads and the route its layout made')
  assert.ok(!v.ids.has(7) && !v.ids.has(1) && !v.ids.has(11), 'another instance, another group and the pour stay out')
  assert.deepEqual([...v.findings], ['drc:clearance:aaaaaaaaaaaa'])
  assert.equal(v.fade, false, 'two instances: hidden, not faded')
  assert.deepEqual(v.frame, [0, -1, 1, 0, 10, 5])
  // the box in the definition's frame: the board box carried back through the frame
  const [bx, by, bw, bh] = v.boardBox
  const back = ([x, y]) => [-(y - 5), x - 10]
  const cs = [back([bx, by]), back([bx + bw, by + bh])]
  assert.deepEqual(
    v.box.map(n => +n.toFixed(6)),
    [Math.min(cs[0][0], cs[1][0]), Math.min(cs[0][1], cs[1][1]), bh, bw].map(n => +n.toFixed(6)),
  )
  assert.deepEqual(isolationLabel(F, s.isolate), { def: 'Chan', shown: 'CH1', follow: 2 })
  // the picker shows another instance's values, the selection following to the same place
  s = showInstance(s, 'CH2')
  assert.deepEqual([s.isolate.ref, s.level, s.refs], ['CH2', 'CH2', ['CH2/R01']])
  assert.equal(isolationView(F, s.isolate).frame, null, 'an instance with no frame shows board coordinates')
  assert.deepEqual([isolate(s, F).isolate, isolate(s, F).refs], [null, ['CH2']], 'I leaves with the instance selected')
  s = escape({ ...s, refs: [], anchor: null }, F)
  assert.deepEqual([s.isolate, s.refs], [null, ['CH2']], 'Escape at the root leaves too')
  // a named group placed once: the board stays, faded
  const g = isolate(click(emptySelection('Fx'), B, pad(1, 'R1', 'A'), plain), B)
  assert.equal(isolationView(B, g.isolate).fade, true)
  assert.equal(isolationLabel(B, g.isolate).follow, 1)
})
