// One call form for the header and connector families: the call gives the footprint factory, and calling that with a value
// and options makes a part. The drill and pad options of the JST and header families, the pad sizes `inspect`
// prints in board axes, and the glyph width of `<text>`.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, NC, bindRef } from '@pcbjs/core'
import * as L from '@pcbjs/lib'
import { compileBoard } from '@pcbjs/compile'
import { inspectBoard } from '@pcbjs/cli/internal/inspect'
import { fresh } from './parts.mjs'

beforeEach(fresh)

const board = (...kids) =>
  compileBoard(h(PCB, { name: 'C', rules: { clearance: 0.2, minTrackWidth: 0.2 } }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 40 }), ...kids), { cache: false })
const open = (p, ref = 'J1') => bindRef(p.connect(Object.fromEntries(p.pins.map(n => [n, NC]))), ref)
const pads = (b, ref) => b.items.filter(i => i.kind === 'pad' && (!ref || i.ref === ref))

test('connectors: every family is a footprint factory, and calling it with a value or options makes a part', () => {
  const forms = [
    [L.PinHeader(3)(), 3],
    [L.PinHeader(3)('PZ254V-11-03P'), 3, 'PZ254V-11-03P'],
    [L.PinHeader(20, { rows: 2 })('GPIO'), 40, 'GPIO'],
    [L.PinSocket(4)(), 4],
    [L.PinSocket(20, { rows: 2 })('GPIO 2x20'), 40, 'GPIO 2x20'],
    [L.PinSocket(2)('S'), 2, 'S'],
    [L.JST_PH(2)(), 2],
    [L.JST_PH(6, 'side')('S6B-PH-K-S'), 6, 'S6B-PH-K-S'],
    [L.JST_PH(2)('B2B'), 2, 'B2B'],
    [L.JST_XH(3)('B3B-XH-A').source({ MPN: 'B3B-XH-A(LF)(SN)' }), 3, 'B3B-XH-A'],
    [L.JST_XH(4)('B4B-XH-A'), 4, 'B4B-XH-A'],
    [L.USBC()(), 9],
    [L.USBC('power6')('TYPE-C-31-M-17'), 5, 'TYPE-C-31-M-17'],
    [L.USBC()('X'), 9, 'X'],
  ]
  for (const [p, n, v] of forms) {
    assert.equal(p.$$, 'part')
    if (n !== undefined) assert.equal(p.pins.length, n)
    if (v !== undefined) assert.equal(p.value, v)
  }
  // a 2-row count is per row: pins 1 to 2n
  assert.deepEqual(L.PinSocket(3, { rows: 2 })().pins, ['1', '2', '3', '4', '5', '6'])
  // withPins renames, the prefix is a generator option
  const J = L.withPins(L.JST_XH(4, { prefix: 'P' }), ['V5', 'GND', 'CANH', 'CANL'])()
  assert.deepEqual(J.pins, ['V5', 'GND', 'CANH', 'CANL'])
  assert.equal(J.prefix, 'P')
  assert.throws(() => L.JST_XH(3, { rows: 2 })(), /JST_XH: unknown option "rows"/)
  assert.throws(() => L.USBC('TYPE-C-31-M-12'), /USBC: the type must be "power6", "full16"/)
  assert.throws(() => L.JST_XH(4, { pinNames: ['A', 'B', 'C', 'D'] }), /JST_XH: rename pins with withPins\(footprint, names\), not a pinNames option/)
  for (const f of [L.PinHeader, L.PinSocket, L.JST_PH, L.JST_XH, L.USBC]) assert.equal(f.footprint, undefined)
})

test('connectors: a generator gives the memoised factory the parts are made from, for parts of their own and withPins', () => {
  const cases = [
    [() => L.JST_XH(3), () => L.JST_XH(3)()],
    [() => L.JST_PH(2, 'side'), () => L.JST_PH(2, 'side')()],
    [() => L.PinSocket(2, { rows: 2 }), () => L.PinSocket(2, { rows: 2 })()],
    [() => L.USBC('power6'), () => L.USBC('power6')()],
  ]
  for (const [ff, mk] of cases) {
    const f = ff()
    assert.equal(typeof f, 'function')
    assert.equal(f, ff())
    assert.equal(f('v').$$, 'part')
    fresh()
    const b = board(h(open(mk()), { at: '20 20' }), h(open(f({ ref: 'J9' })), { at: '10 10' }))
    assert.equal(pads(b, 'J9').length, pads(b).length / 2)
  }
  assert.equal(L.JST_XH(3, { prefix: 'P' }), L.JST_XH(3, { prefix: 'P' }))
  const W = L.withPins(L.JST_XH(2), ['VBAT', 'GND'])
  assert.deepEqual(W('x').pins, ['VBAT', 'GND'])
  fresh()
  // .source() on a part of the factory
  const { A, B } = nets()
  const p = bindRef(L.JST_XH(2)('B2B-XH-A').source({ MPN: 'B2B-XH-A(LF)(SN)' }).connect({ 1: A, 2: B }), 'J1')
  const b = board(h(p, { at: '20 20' }))
  assert.equal(b.footprints[0].fields.MPN, 'B2B-XH-A(LF)(SN)')
  // the header's footprint form
  const H = L.PinHeader(2, { rows: 2 })
  assert.deepEqual(H.pins, ['1', '2', '3', '4'])
  assert.equal(pads(board(h(H({ ref: 'J1' }), { at: '10 10' }))).length, 4)
})

test('connectors: drill and pad options, datasheet defaults, a house variant gets its own id', () => {
  const ph = b => pads(b).map(p => [p.size, p.drill])
  const stock = board(h(open(L.JST_PH(6, 'side')()), { at: '20 20' }))
  assert.deepEqual(ph(stock)[1], [
    [1.2, 1.75],
    [0.75, 0.75],
  ])
  const house = board(h(open(L.JST_PH(6, 'side', { drill: 0.8 })()), { at: '20 20' }))
  assert.deepEqual(ph(house)[1], [
    [1.2, 1.75],
    [0.8, 0.8],
  ])
  assert.match(house.footprints[0].id, /_Drill0\.8mm$/)
  assert.doesNotMatch(stock.footprints[0].id, /Drill/)
  const xh = board(h(open(L.JST_XH(2, { drill: 1.0, pad: [1.8, 2.1] })()), { at: '20 20' }))
  assert.deepEqual(ph(xh)[0], [
    [1.8, 2.1],
    [1.0, 1.0],
  ])
  assert.deepEqual(ph(board(h(open(L.JST_XH(2)()), { at: '20 20' })))[0], [
    [1.7, 1.95],
    [0.95, 0.95],
  ])
  const sock = board(h(open(L.PinSocket(2, { drill: 1.1, pad: 1.8 })()), { at: '20 20' }))
  assert.deepEqual(ph(sock)[1], [
    [1.8, 1.8],
    [1.1, 1.1],
  ])
  const hdr = board(h(open(L.PinHeader(2, { drill: 1.1, pad: 1.9 })()), { at: '20 20' }))
  assert.deepEqual(ph(hdr)[1], [
    [1.9, 1.9],
    [1.1, 1.1],
  ])
  assert.match(hdr.footprints[0].id, /_Drill1\.1mm_Pad1\.9x1\.9mm$/)
  const fine = board(h(open(L.PinHeader(2, { pitch: 1.27 })()), { at: '20 20' }))
  assert.deepEqual(ph(fine)[1], [
    [1, 1],
    [0.6, 0.6],
  ])
  assert.throws(() => L.JST_PH(2, 'top', { drill: 1.2 })(), /JST_PH: a 1.2 x 1.75 mm pad around a 1.2 mm drill leaves less than a 0.1 mm ring/)
  assert.throws(() => L.JST_XH(2, { drill: '0.8' })(), /JST_XH: drill must be a positive number of mm/)
  assert.throws(() => L.PinHeader(2, { pad: [1.7] })(), /PinHeader: pad must be a size in mm/)
})

test('inspect: pad sizes in board axes, the footprint axes under footprintSize in the JSON', () => {
  const b = board(h(open(L.JST_PH(2)()), { at: '20 20 90deg' }), h(open(L.JST_PH(2)(), 'J2'), { at: '20 30' }))
  const r = inspectBoard(b, 'c.tsx', '/', 'J1')
  const p = r.json.part.pads[0]
  assert.deepEqual(p.size, [1.75, 1.2])
  assert.deepEqual(p.footprintSize, [1.2, 1.75])
  assert.match(r.text.join('\n'), /1\.75 x 1\.20 roundrect drill 0\.75/)
  const flat = inspectBoard(b, 'c.tsx', '/', 'J2').json.part.pads[0]
  assert.deepEqual(flat.size, [1.2, 1.75])
  assert.deepEqual(flat.footprintSize, [1.2, 1.75])
})

test('text: width stretches the glyphs across the baseline, size keeps the cap height', () => {
  const T = w => board(h('text', { layer: 'F.SilkS', at: '20 20', size: 1.25, ...(w ? { width: w } : {}), anchor: 'start' }, 'H')).items.find(i => i.kind === 'text')
  const ext = t => {
    const xs = t.strokes.flat().map(q => q[0]),
      ys = t.strokes.flat().map(q => q[1])
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
  }
  const [w0, h0] = ext(T()),
    [w1, h1] = ext(T(1.35))
  assert.ok(Math.abs(h1 - h0) < 1e-6 && Math.abs(h0 - 1.25) < 1e-6)
  assert.ok(Math.abs(w1 / w0 - 1.35 / 1.25) < 1e-6)
  assert.equal(T(1.35).width, 1.35)
  assert.equal(T().width, undefined)
})
