// Automatic schematic placement: clustering by connectivity, the free page or the paper asked for, determinism and hand placements kept.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, defineFootprint, resetDefaults, Schematic, Sym } from '@pcbjs/core'
import { autoSymbol } from '@pcbjs/core/sch-symbol'
import { compileBoard } from '../dist/index.js'
import { clusters, place } from '../dist/sch-place.js'

afterEach(() => resetDefaults())

const pad = (num, x) => h('pad', { num, at: [x, 0], size: [0.8, 0.8] })
const Two = prefix => defineFootprint(p => h('footprint', p, pad(1, -1), pad(2, 1)), { pins: ['1', '2'], prefix })
const R = Two('R'),
  C = Two('C')
const PINS = ['VDD', 'IN', 'EN', 'OUT', 'FB', 'GND']
const Chip = defineFootprint(p => h('footprint', p, ...PINS.map((n, i) => h('pad', { num: i + 1, name: n, at: [i * 1.3, 0], size: [0.8, 0.8] }))), { pins: PINS, prefix: 'U' })
const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 60, h: 40 })
const board = (sch, ...parts) =>
  compileBoard(
    h(PCB, { name: 'P', silkRefs: false, ...(sch ? { schematic: sch } : {}) }, edge(), ...parts.map((p, i) => h(p, { at: [3 + (i % 10) * 5, 5 + Math.floor(i / 10) * 5] }))),
    { routeCache: false },
  )
const grid = d => s => s.at.map(v => Math.round(v / d.grid))
const power = n => /^(GND|VCC|V3V3)$/.test(n),
  ground = n => n === 'GND'

const item = (ref, prefix, pins, order) => ({
  ref,
  value: 'x',
  prefix,
  order,
  path: [],
  sym: autoSymbol({ prefix, pins: pins.map(p => p[0]) }),
  pins: pins.map(([name, net]) => ({ name, net })),
})
const chip = (ref, order, sig) =>
  item(
    ref,
    'U',
    [
      ['VDD', 'VCC'],
      ['IN', `${sig}_IN`],
      ['EN', `${sig}_EN`],
      ['OUT', `${sig}_OUT`],
      ['GND', 'GND'],
    ],
    order,
  )

test('clusters: a decoupling capacitor, a pull-up and a series part join the symbol they serve', () => {
  const items = [
    chip('U1', 0, 'A'),
    chip('U2', 10, 'B'),
    item(
      'C1',
      'C',
      [
        ['1', 'VCC'],
        ['2', 'GND'],
      ],
      2,
    ),
    item(
      'R1',
      'R',
      [
        ['1', 'A_EN'],
        ['2', 'VCC'],
      ],
      3,
    ),
    item(
      'R2',
      'R',
      [
        ['1', 'A_OUT'],
        ['2', 'B_IN'],
      ],
      2,
    ),
    item(
      'D1',
      'D',
      [
        ['A', 'B_OUT'],
        ['K', 'LED'],
      ],
      11,
    ),
    item(
      'R3',
      'R',
      [
        ['1', 'LED'],
        ['2', 'GND'],
      ],
      12,
    ),
  ]
  const blocks = clusters(items, power, ground)
  const of = ref => blocks.find(b => b.members.some(m => m.it.ref === ref)).members.map(m => m.it.ref)
  assert.deepEqual(
    blocks.map(b => b.members[0].it.ref),
    ['U1', 'U2'],
    'every small part joins an IC',
  )
  assert.ok(of('U1').includes('C1') && of('U1').includes('R1') && of('U1').includes('R2'))
  assert.ok(of('U2').includes('D1') && of('U2').includes('R3'), 'the LED and its resistor chain off U2.OUT')
  const u1 = blocks[0].members
  const at = ref => u1.find(m => m.it.ref === ref)
  assert.ok(at('C1').at[1] < 0 && [90, 270].includes(at('C1').rot), 'the capacitor stands above the supply pins')
  assert.ok(at('R2').at[0] > 0 && at('R2').rot === 0, 'the series resistor lies along the wire from OUT, on the right')
  const u2 = blocks[1].members
  assert.ok(u2.find(m => m.it.ref === 'R3').at[0] > u2.find(m => m.it.ref === 'D1').at[0], 'the chain runs outward')
})

test('place: a free page by default, packed about A-paper wide, fitted to what is drawn', () => {
  const few = [
    chip('U1', 0, 'A'),
    item(
      'C1',
      'C',
      [
        ['1', 'VCC'],
        ['2', 'GND'],
      ],
      1,
    ),
  ]
  const opts = { power, ground, wired: () => true, fixed: [], grid: 2.54, order: 'pins' }
  assert.equal(place({ ...opts, items: few, sheet: null }).paper, null)
  const many = Array.from({ length: 60 }, (_, i) => chip(`U${i + 1}`, i, `S${i}`))
  const free = place({ ...opts, items: many, sheet: null })
  const xs = [...free.at.values()].map(q => q.at[0]),
    ys = [...free.at.values()].map(q => q.at[1])
  const w = Math.max(...xs) - Math.min(...xs),
    hh = Math.max(...ys) - Math.min(...ys)
  assert.ok(w > hh && w < 2.5 * hh, `wider than high, not a strip: ${w} x ${hh}`)
  const { A, B, X, Y, VCC, GND } = nets()
  const d = sch(board(null, Chip('X').connect({ VDD: VCC, IN: A, EN: B, OUT: X, FB: Y, GND })))
  assert.equal(d.paper, undefined, 'no paper')
  const ends = d.symbols.flatMap(s => [[s.box[0], s.box[1]], [s.box[2], s.box[3]], ...s.pins.map(q => q.end)]).concat(d.labels.map(l => l.at))
  const g = d.grid
  for (const [x, y] of ends) assert.ok(x >= d.page[0] + 2 * g && x <= d.page[2] - 2 * g && y >= d.page[1] + 2 * g && y <= d.page[3] - 2 * g, `${x} ${y} inside the margin`)
  assert.ok(d.page[2] - d.page[0] < 120 && d.page[3] - d.page[1] < 120, `the page hugs the drawing: ${d.page}`)
})

test('place: <Schematic sheet> opts into a paper, the smallest from it up, or a fixed size', () => {
  const few = [
    chip('U1', 0, 'A'),
    item(
      'C1',
      'C',
      [
        ['1', 'VCC'],
        ['2', 'GND'],
      ],
      1,
    ),
  ]
  const opts = { power, ground, wired: () => true, fixed: [], grid: 2.54, order: 'pins' }
  assert.equal(place({ ...opts, items: few, sheet: 0 }).paper, 'A4')
  const many = Array.from({ length: 60 }, (_, i) => chip(`U${i + 1}`, i, `S${i}`))
  assert.ok(['A2', 'A1', 'A0'].includes(place({ ...opts, items: many, sheet: 0 }).paper))
  assert.equal(place({ ...opts, items: few, sheet: 1 }).paper, 'A3', 'a sheet prop is the smallest allowed')
  const { A, B, X, Y, VCC, GND } = nets()
  const part = () => Chip('X').connect({ VDD: VCC, IN: A, EN: B, OUT: X, FB: Y, GND })
  const a4 = sch(board(h(Schematic, { sheet: 'A4' }), part()))
  assert.deepEqual([a4.paper, a4.page], [{ name: 'A4', w: 297, h: 210 }, [0, 0, 297, 210]])
  const custom = sch(board(h(Schematic, { sheet: { w: 200, h: '150mm' } }), part()))
  assert.deepEqual(custom.paper, { name: 'custom', w: 200, h: 150 })
  assert.throws(() => board(h(Schematic, { sheet: 'B5' }), part()), /sheet must be one of A4, A3, A2, A1, A0 or \{ w, h \}/)
})

const sch = b => b.schematic.drawing
const design = () => {
  const { A, B, X, VCC, GND } = nets()
  const U1 = Chip('X').connect({ VDD: VCC, IN: A, EN: B, OUT: X, FB: X, GND })
  const U2 = Chip('Y').connect({ VDD: VCC, IN: X, EN: B, OUT: A, FB: A, GND })
  return [U1, U2, C('100n').connect(VCC, GND), C('1u').connect(VCC, GND), R('10k').connect(B, VCC), R('33').connect(A, X)]
}

test('place: the same input gives the same drawing', () => {
  const a = JSON.stringify(sch(board(null, ...design())))
  resetDefaults()
  const b = JSON.stringify(sch(board(null, ...design())))
  assert.equal(a, b)
})

test('place: hand placements stay where they are and the rest packs around them', () => {
  const parts = design()
  const [U1] = parts
  const b = board(h(Schematic, {}, h(Sym, { part: U1, at: '20 12' })), ...parts)
  const d = sch(b)
  const hand = d.symbols.find(s => !s.auto)
  assert.deepEqual(grid(d)(hand), [20, 12])
  assert.equal(d.symbols.filter(s => s.auto).length, parts.length - 1)
  assert.deepEqual(
    b.erc.filter(f => f.rule === 'sch-overlap'),
    [],
  )
  const [x0, y0, x1, y1] = hand.box
  for (const s of d.symbols.filter(s => s.auto)) {
    const [a0, b0, a1, b1] = s.box
    assert.ok(a1 <= x0 || a0 >= x1 || b1 <= y0 || b0 >= y1, `${s.ref} clear of the hand-placed symbol`)
  }
})
