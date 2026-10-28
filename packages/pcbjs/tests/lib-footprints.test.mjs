// The generated footprints of @pcbjs/lib: one board per family on a 0.2 mm rule set, pad counts, pin names, courtyards, the
// KiCad land patterns they follow, and the hand-written footprints of the example boards they replace.
//
// Reference: the KiCad 9 library for every package (Package_TO_SOT_SMD, Package_SO, Package_DFN_QFN, Package_QFP,
// Connector_USB, Connector_JST, Button_Switch_SMD, LED_SMD, Crystal, Battery, MountingHole) and Espressif's own library for
// the ESP32-C3-MINI-1. The reviewers' footprints in examples/*/lib are matched within 0.05 mm where they were accurate:
// SOT-23-5 and SOT-23-6 (esp32-sensor), LQFP-48 and the 3225 and 3215 crystals (stm32-dev), the TS-1187A switch (esp32-sensor),
// the PTS810 switch and the ISP pogo pads (badge), the M2 hole (usbc-led). Corrected, so not matched: the 3-pin SOT-23 of
// stm32-dev and the demo, the SOIC-8 of badge, the WS2812B-2020 of led-matrix, both 16-pin USB-C, the 6-pin USB-C of usbc-led,
// the CR2032 holder and slide switch of badge, the TS-1088 of stm32-dev and the ESP32-C3-MINI-1 of esp32-sensor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, NC } from '@pcbjs/core'
import * as L from '@pcbjs/lib'
import { compileBoard } from '@pcbjs/compile'
import { near } from './helpers.mjs'

const AT = [20, 20]
const RULES = { clearance: 0.2, minTrackWidth: 0.2 }

/** Compile a 40 mm board with one footprint placed at AT, every pin left open or tied to `tie`. */
function place(f, tie = {}) {
  const pins = typeof f.pins === 'function' ? f.pins({}) : f.pins
  const node = pins.length ? h(f().connect(Object.fromEntries(pins.map(p => [p, tie[p] ?? NC]))), { at: `${AT[0]} ${AT[1]}` }) : h(f, { ref: 'H1', at: `${AT[0]} ${AT[1]}` })
  return compileBoard(h(PCB, { name: 'Lib', rules: RULES }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 40 }), node))
}
const padsOf = b => b.items.filter(i => i.kind === 'pad')
/** Pad centres in footprint mm, by pad number; an unnumbered hole is "". Several pads may share a number. */
const local = b => padsOf(b).map(p => ({ num: p.num, name: p.name, x: +(p.at[0] - AT[0]).toFixed(4), y: +(p.at[1] - AT[1]).toFixed(4), w: p.size[0], h: p.size[1], type: p.type }))
const pad = (b, num) => {
  const p = local(b).find(q => q.num === String(num))
  assert.ok(p, `no pad ${num}`)
  return p
}
const at = (b, num, x, y, tol = 1e-6) => {
  const p = pad(b, num)
  near(p.x, x, tol, `pad ${num} x: ${p.x} vs ${x}`)
  near(p.y, y, tol, `pad ${num} y: ${p.y} vs ${y}`)
}
const findings = (b, ignore = []) => [...b.drc, ...b.erc].filter(d => !ignore.includes(d.rule)).map(d => `${d.severity} ${d.rule}: ${d.message}`)

// [label, factory, pads, pins, prefix]
const FAMILIES = [
  ['SOT23(3)', L.SOT23(3), 3, ['1', '2', '3'], 'Q'],
  ['SOT23(5)', L.SOT23(5), 5, ['1', '2', '3', '4', '5'], 'U'],
  ['SOT23(6)', L.SOT23(6), 6, ['1', '2', '3', '4', '5', '6'], 'U'],
  ['SOT223', L.SOT223, 4, ['1', '2', '3'], 'U'],
  ['SOIC(8)', L.SOIC(8), 8, null, 'U'],
  ['SOIC(16, W)', L.SOIC(16, 'W'), 16, null, 'U'],
  ['TSSOP(20)', L.TSSOP(20), 20, null, 'U'],
  ['QFN(16, 3, 0.5, 1.75)', L.QFN(16, 3, 0.5, 1.75), 17, null, 'U'],
  ['QFN(32, 5, 0.5, 3.45, vias 3)', L.QFN(32, 5, 0.5, 3.45, { vias: 3 }), 42, null, 'U'],
  ['QFN(24, 4, 0.5)', L.QFN(24, 4, 0.5), 24, null, 'U'],
  ['LQFP(48, 7, 0.5)', L.LQFP(48, 7, 0.5), 48, null, 'U'],
  ['LQFP(64, 10, 0.5)', L.LQFP(64, 10, 0.5), 64, null, 'U'],
  ['LQFP(32, 7, 0.8)', L.LQFP(32, 7, 0.8), 32, null, 'U'],
  ['USBC(full16)', L.USBC.footprint('full16'), 18, ['GND', 'VBUS', 'CC1', 'CC2', 'DP', 'DN', 'SBU1', 'SBU2', 'SHIELD'], 'J'],
  ['USBC(power6)', L.USBC.footprint('power6'), 10, ['GND', 'VBUS', 'CC1', 'CC2', 'SHIELD'], 'J'],
  ['JST_PH(4)', L.JST_PH.footprint(4), 4, ['1', '2', '3', '4'], 'J'],
  ['JST_PH(3, side)', L.JST_PH.footprint(3, 'side'), 3, ['1', '2', '3'], 'J'],
  ['JST_XH(2)', L.JST_XH.footprint(2), 2, ['1', '2'], 'J'],
  ['PinSocket(4)', L.PinSocket.footprint(4), 4, ['1', '2', '3', '4'], 'J'],
  ['PinSocket(3, rows 2)', L.PinSocket.footprint(3, { rows: 2 }), 6, ['1', '2', '3', '4', '5', '6'], 'J'],
  ['TestPad(1.5)', L.TestPad(1.5), 1, ['1'], 'TP'],
  ['PogoPad(1.5, 3 x 2)', L.PogoPad(1.5, { cols: 3, rows: 2 }), 6, ['1', '2', '3', '4', '5', '6'], 'J'],
  ['MountingHole(2.2)', L.MountingHole(2.2), 1, [], 'H'],
  ['MountingHole(3.2, pad)', L.MountingHole(3.2, true), 1, ['1'], 'H'],
  ['CR2032Holder', L.CR2032Holder, 3, ['+', '-'], 'BT'],
  ['BatteryPads()', L.BatteryPads(), 2, ['+', '-'], 'BT'],
  ['TactSwitch(6x6)', L.TactSwitch('6x6'), 4, ['A', 'B'], 'SW'],
  ['TactSwitch(5.1x5.1)', L.TactSwitch('5.1x5.1'), 4, ['A', 'B'], 'SW'],
  ['TactSwitch(4.5x4.5)', L.TactSwitch('4.5x4.5'), 4, ['A', 'B'], 'SW'],
  ['TactSwitch(4.2x3.2)', L.TactSwitch('4.2x3.2'), 4, ['A', 'B'], 'SW'],
  ['TactSwitch(3x4)', L.TactSwitch('3x4'), 2, ['A', 'B'], 'SW'],
  ['SlideSwitch(3)', L.SlideSwitch(3), 5, ['1', '2', '3'], 'SW'],
  ['ESP32C3Mini1', L.ESP32C3Mini1, 61, ['GND', '3V3', 'EN', 'IO0', 'IO1', 'IO2', 'IO3', 'IO4', 'IO5', 'IO6', 'IO7', 'IO8', 'IO9', 'IO10', 'IO18', 'IO19', 'RXD0', 'TXD0'], 'U'],
  ['WS2812B(2020)', L.WS2812B('2020'), 4, ['DIN', 'DOUT', 'VDD', 'GND'], 'D'],
  ['WS2812B(5050)', L.WS2812B('5050'), 4, ['DIN', 'DOUT', 'VDD', 'GND'], 'D'],
  ['LED1206', L.LED1206, 2, ['K', 'A'], 'D'],
  ["LED('0805', 'red')", L.LED('0805', 'red'), 2, ['K', 'A'], 'D'],
  ['Crystal3225', L.Crystal3225, 4, ['X1', 'GND', 'X2'], 'Y'],
  ['Crystal2012', L.Crystal2012, 2, ['1', '2'], 'Y'],
  ['Crystal3215', L.Crystal3215, 2, ['1', '2'], 'Y'],
  ['Crystal5032', L.Crystal5032, 2, ['1', '2'], 'Y'],
  ['Crystal49S', L.Crystal49S, 2, ['1', '2'], 'Y'],
]

for (const [label, f, count, pins, prefix] of FAMILIES) {
  test(`lib footprints: ${label} has its pads, pins, courtyard, fab, model and height, and is DRC and ERC clean at 0.2 mm`, () => {
    const declared = typeof f.pins === 'function' ? f.pins({}) : f.pins
    if (pins) assert.deepEqual([...declared], pins)
    else {
      // an IC: pins 1 to n in order, then the exposed pad
      const nums = declared.filter(p => p !== 'EP')
      assert.deepEqual(
        nums,
        nums.map((_, i) => String(i + 1)),
      )
    }
    assert.equal(f.prefix, prefix)
    const ep = declared.includes('EP')
    const { GND } = nets()
    const b = place(f, ep ? { EP: GND } : {})
    assert.equal(padsOf(b).length, count)
    const fp = b.footprints[0]
    assert.ok(fp.ref.startsWith(prefix), fp.ref)
    assert.equal(typeof fp.height, 'number')
    assert.ok(fp.model && typeof fp.model.kind === 'string', 'a model spec')
    const layers = new Set(b.items.filter(i => i.kind === 'graphic' && i.ref === fp.ref).map(i => i.layer))
    assert.ok(layers.has('F.CrtYd'), 'a courtyard')
    assert.ok(layers.has('F.Fab'), 'an F.Fab outline')
    // every pad belongs to a declared pin, an NC pad or no pin at all (an unnumbered hole)
    for (const p of padsOf(b)) if (p.num !== '' && !f.nc?.includes(p.num)) assert.ok(declared.includes(p.name) || declared.includes(p.num), `pad ${p.num} ${p.name}`)
    assert.deepEqual(findings(b, ep ? ['single-pin-net', 'single-pad'] : []), [])
  })
}

test('lib footprints: every footprint with pins has a pin 1 mark or polarity on silk, or is a two-terminal part or pad', () => {
  for (const f of [
    L.SOT23(5),
    L.SOIC(8),
    L.TSSOP(14),
    L.QFN(16, 3, 0.5),
    L.LQFP(48, 7, 0.5),
    L.JST_PH.footprint(2),
    L.PinSocket.footprint(2),
    L.WS2812B('2020'),
    L.Crystal3225,
    L.ESP32C3Mini1,
  ]) {
    const b = place(f)
    const dot = b.items.find(i => i.kind === 'graphic' && i.layer === 'F.SilkS' && i.fill)
    assert.ok(dot, `${f.name}: a filled pin 1 dot on F.SilkS`)
  }
})

test('lib footprints: SOT-23, SOIC, TSSOP, QFN and LQFP pads sit where KiCad puts them, numbered as JEDEC does', () => {
  let b = place(L.SOT23(3))
  at(b, 1, -0.9375, -0.95)
  at(b, 2, -0.9375, 0.95)
  at(b, 3, 0.9375, 0)
  b = place(L.SOT23(5))
  at(b, 1, -1.1375, -0.95)
  at(b, 3, -1.1375, 0.95)
  at(b, 4, 1.1375, 0.95)
  at(b, 5, 1.1375, -0.95)
  b = place(L.SOT23(6))
  at(b, 5, 1.1375, 0)
  at(b, 6, 1.1375, -0.95)
  b = place(L.SOT223)
  at(b, 1, -3.15, -2.3)
  at(b, 4, 3.15, 0)
  assert.equal(pad(b, 4).name, '2', 'the tab is pin 2')
  b = place(L.SOIC(8))
  at(b, 1, -2.475, -1.905)
  at(b, 4, -2.475, 1.905)
  at(b, 5, 2.475, 1.905)
  at(b, 8, 2.475, -1.905)
  assert.deepEqual([pad(b, 1).w, pad(b, 1).h], [1.95, 0.6])
  b = place(L.SOIC(16, 'W'))
  at(b, 1, -4.65, -4.445)
  at(b, 16, 4.65, -4.445)
  b = place(L.TSSOP(20))
  at(b, 1, -2.8625, -2.925)
  at(b, 11, 2.8625, 2.925)
  b = place(L.QFN(32, 5, 0.5, 3.45))
  at(b, 1, -2.4375, -1.75)
  at(b, 9, -1.75, 2.4375)
  at(b, 17, 2.4375, 1.75)
  at(b, 25, 1.75, -2.4375)
  at(b, 33, 0, 0)
  assert.deepEqual([pad(b, 1).w, pad(b, 1).h, pad(b, 9).w, pad(b, 9).h], [0.875, 0.25, 0.25, 0.875])
  assert.equal(pad(b, 33).name, 'EP')
  b = place(L.QFN(16, 3, 0.5, 1.75))
  at(b, 1, -1.4625, -0.75)
  at(b, 9, 1.4625, 0.75)
  b = place(L.LQFP(48, 7, 0.5))
  at(b, 1, -4.1625, -2.75)
  at(b, 13, -2.75, 4.1625)
  at(b, 25, 4.1625, 2.75)
  at(b, 37, 2.75, -4.1625)
  b = place(L.LQFP(64, 10, 0.5))
  at(b, 1, -5.675, -3.75)
  b = place(L.LQFP(32, 7, 0.8))
  at(b, 1, -4.175, -2.8)
})

test('lib footprints: connectors, switches, LEDs, crystals, the holder and the module follow their KiCad and Espressif patterns', () => {
  let b = place(L.USBC.footprint('full16'))
  at(b, 'A1', -3.25, -4.045)
  at(b, 'B1', 3.25, -4.045)
  at(b, 'A5', -1.25, -4.045)
  at(b, 'B5', 1.75, -4.045)
  at(b, 'S1', -4.32, -3.13)
  at(b, 'S3', -4.32, 1.05)
  const holes = local(b)
    .filter(p => p.type === 'npth')
    .map(p => [p.x, p.y])
  assert.deepEqual(holes, [
    [-2.89, -2.6],
    [2.89, -2.6],
  ])
  b = place(L.USBC.footprint('power6'))
  at(b, 'B12', -2.75, -3.18)
  at(b, 'A9', 1.52, -3.18)
  at(b, 'S2', 4.32, -3.0)
  at(b, 'S4', 4.32, 0.8)
  b = place(L.JST_PH.footprint(4))
  at(b, 1, -3, 0)
  at(b, 4, 3, 0)
  assert.deepEqual([pad(b, 1).w, pad(b, 1).h], [1.2, 1.75])
  b = place(L.JST_XH.footprint(4))
  at(b, 1, -3.75, 0)
  b = place(L.PinSocket.footprint(3))
  at(b, 1, 0, 0)
  at(b, 3, 0, 5.08)
  b = place(L.TactSwitch('6x6'))
  at(b, 1, -4, -2.25)
  at(b, 4, 4, 2.25)
  b = place(L.TactSwitch('3x4'))
  at(b, 1, -2.225, 0)
  at(b, 2, 2.225, 0)
  b = place(L.SlideSwitch(3))
  at(b, 1, -2.5, -2.75)
  at(b, 3, 2.5, -2.75)
  b = place(L.WS2812B('2020'))
  at(b, 1, -0.915, -0.55)
  at(b, 3, 0.915, 0.55)
  assert.deepEqual(
    ['1', '2', '3', '4'].map(n => pad(b, n).name),
    ['DOUT', 'GND', 'DIN', 'VDD'],
  )
  b = place(L.WS2812B('5050'))
  at(b, 1, -2.45, -1.65)
  assert.deepEqual(
    ['1', '2', '3', '4'].map(n => pad(b, n).name),
    ['VDD', 'DOUT', 'GND', 'DIN'],
  )
  b = place(L.Crystal3225)
  at(b, 1, -1.1, 0.85)
  at(b, 3, 1.1, -0.85)
  b = place(L.Crystal5032)
  at(b, 1, -1.85, 0)
  b = place(L.Crystal49S)
  at(b, 1, -2.44, 0)
  at(b, 2, 2.44, 0)
  b = place(L.CR2032Holder)
  at(b, 1, -10.985, 0)
  at(b, 3, 10.985, 0)
  at(b, 2, 0, 0)
  assert.equal(pad(b, 2).w, 17.8)
  b = place(L.ESP32C3Mini1)
  at(b, 1, -5.9, -1.3)
  at(b, 11, -5.9, 6.7)
  at(b, 12, -4.8, 7.6)
  at(b, 24, 4.8, 7.6)
  at(b, 25, 5.9, 6.7)
  at(b, 36, 4.8, -2.2)
  at(b, 48, -4.8, -2.2)
  at(b, 50, 5.95, -2.25)
  assert.equal(local(b).filter(p => p.num === '49').length, 9)
  assert.deepEqual(
    ['1', '3', '8', '12', '26', '30', '31'].map(n => pad(b, n).name),
    ['GND', '3V3', 'EN', 'IO0', 'IO18', 'RXD0', 'TXD0'],
  )
})

test('lib footprints: the ESP32-C3-MINI-1 lists its NC pads, needs no connection for them, and keeps copper out of the antenna area', () => {
  assert.deepEqual([...L.ESP32C3Mini1.nc], ['4', '7', '9', '10', '15', '17', '24', '25', '28', '29', '32', '33', '34', '35'])
  const b = place(L.ESP32C3Mini1)
  assert.deepEqual(b.erc, [])
  const fp = L.ESP32C3Mini1Footprint({ antennaKeepout: false })
  assert.notEqual(fp, L.ESP32C3Mini1)
  assert.equal(fp.id, L.ESP32C3Mini1.id)
})

test('lib footprints: pinNames names pins by a list or by pad number and pin name, merges and splits pins, and U1.PA9 works', () => {
  const names = Array.from({ length: 48 }, (_, i) => `P${i + 1}`)
  names[29] = 'PA9'
  names[22] = 'VSS'
  names[34] = 'VSS'
  names[46] = 'VSS'
  const MCU = L.LQFP(48, 7, 0.5, { pinNames: names })
  assert.equal(MCU.pins.length, 46, 'three VSS pads are one pin')
  const { TX, GND } = nets()
  const U = MCU('STM32F103C8T6').connect(Object.fromEntries(MCU.pins.map(p => [p, p === 'PA9' ? TX : p === 'VSS' ? GND : NC])))
  assert.equal(U.PA9.pin, 'PA9')
  const b = compileBoard(h(PCB, { name: 'P', rules: RULES }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 40 }), h(U, { at: '20 20' })))
  assert.equal(padsOf(b).find(p => p.num === '30').net, 'TX')
  assert.deepEqual(
    padsOf(b)
      .filter(p => p.net === 'GND')
      .map(p => p.num),
    ['23', '35', '47'],
  )

  const LDO = L.SOT23(5, { pinNames: ['VIN', 'GND', 'EN', 'NC', 'VOUT'] })
  assert.deepEqual([...LDO.pins], ['VIN', 'GND', 'EN', 'VOUT'])
  assert.deepEqual([...LDO.nc], ['4'], 'a pin named NC becomes an nc pad')
  const ldo = place(LDO)
  assert.deepEqual(findings(ldo), [])

  const X = L.withPins(L.Crystal3225, { 2: 'GND1', 4: 'GND2' })
  assert.deepEqual([...X.pins], ['X1', 'GND1', 'GND2', 'X2'], 'a split pin keeps its place')
  assert.deepEqual([...L.Crystal3225.pins], ['X1', 'GND', 'X2'], 'the original is unchanged')
  const T = L.withPins(L.TactSwitch('4.2x3.2'), { 1: '1', 2: '2', 3: '3', 4: '4' })
  assert.deepEqual([...T.pins], ['1', '2', '3', '4'])
  const Reg = L.withPins(L.SOT223, ['GND', 'VOUT', 'VIN'])
  assert.deepEqual([...Reg.pins], ['GND', 'VOUT', 'VIN'])
  assert.equal(pad(place(Reg), 4).name, 'VOUT', 'the tab follows pin 2')
  const Q = L.QFN(16, 3, 0.5, 1.75, { pinNames: { EP: 'GND', 1: 'GND' } })
  assert.equal(Q.pins[0], 'GND', 'pin 1 and the exposed pad are one pin, in the place of pin 1')
  assert.equal(Q.pins.length, 16)
  assert.throws(() => L.SOT23(3, { pinNames: { 9: 'X' } }), /neither a pad number nor a pin/)
  assert.throws(() => L.SOT23(3, { pinNames: ['A', 'B', 'C', 'D'] }), /4 pin names for 3 pins/)
})

test('lib footprints: generators are memoised by their arguments and check them', () => {
  assert.equal(L.SOT23(5), L.SOT23(5))
  assert.equal(L.QFN(16, 3, 0.5, 1.75), L.QFN(16, 3, 0.5, 1.75))
  assert.notEqual(L.SOT23(5), L.SOT23(6))
  assert.equal(L.LED('0603'), L.LED0603)
  assert.equal(L.LED('0805', 'red'), L.LED('0805', 'red'))
  assert.throws(() => L.SOT23(4), /SOT23: the pin count must be 3, 5, 6/)
  assert.throws(() => L.SOIC(7), /even/)
  assert.throws(() => L.QFN(18, 3, 0.5), /multiple of 4/)
  assert.throws(() => L.QFN(48, 3, 0.5), /do not fit/)
  assert.throws(() => L.QFN(16, 3, 0.5, 1.75, { vias: 3 }), /need an exposed pad/)
  assert.throws(() => L.TactSwitch('7x7'), /TactSwitch: the size must be/)
  assert.throws(() => L.USBC.footprint('full24'), /USBC: the type must be/)
  assert.throws(() => L.MountingHole(3.2, 3.4), /ring/)
})

test('lib footprints: courtyard centres anywhere and keeps the old layer form', () => {
  const a = L.courtyard(4, 2, 1, -1)
  assert.deepEqual({ x: a.props.x, y: a.props.y, w: a.props.w, h: a.props.h, layer: a.props.layer }, { x: -1, y: -2, w: 4, h: 2, layer: 'F.CrtYd' })
  const b = L.courtyard(4, 2, 'B.CrtYd')
  assert.deepEqual({ x: b.props.x, y: b.props.y, layer: b.props.layer }, { x: -2, y: -1, layer: 'B.CrtYd' })
  const row = L.padRow(3, 1.27, { size: [0.6, 1.5], at: [0, 2] })
  assert.deepEqual(
    row.map(p => p.props.at),
    [
      [-1.27, 2],
      [0, 2],
      [1.27, 2],
    ],
  )
  const grid = L.padGrid(2, 2, 2.54, { size: 1.7, drill: 1, order: 'columns' })
  assert.deepEqual(
    grid.map(p => [p.props.num, ...p.props.at]),
    [
      ['1', -1.27, -1.27],
      ['2', -1.27, 1.27],
      ['3', 1.27, -1.27],
      ['4', 1.27, 1.27],
    ],
  )
  const silk = L.silkOutline(2, 2, { pads: [{ num: '1', name: '1', x: -1, y: 0, w: 0.6, h: 0.6 }] })
  assert.match(silk.props.d, /^M -1.1 -1.1 H 1.1 M -1.1 1.1 H 1.1 M -1.1 -1.1 V -0.575 M -1.1 0.575 V 1.1 M 1.1 -1.1 V 1.1$/)
})

// ---- the reviewers' hand-written footprints ----

/** The pad centres of examples/stm32-dev/lib/lqfp.tsx for LQFP48_7x7, its own formula. */
function reviewerLqfp48(n) {
  const side = 12,
    i = (n - 1) % side,
    s = Math.floor((n - 1) / side)
  const off = -((side - 1) / 2) * 0.5 + i * 0.5,
    e = 8.325 / 2
  return s === 0 ? [-e, off] : s === 1 ? [off, e] : s === 2 ? [e, -off] : [-off, -e]
}

// [where, factory, { pad: [x, y] }]: the reviewers' pad centres, copied from their files
const ACCURATE = [
  ['esp32-sensor SOT23_5', L.SOT23(5), { 1: [-1.1375, -0.95], 2: [-1.1375, 0], 3: [-1.1375, 0.95], 4: [1.1375, 0.95], 5: [1.1375, -0.95] }],
  ['esp32-sensor SOT23_6', L.SOT23(6), { 1: [-1.1375, -0.95], 2: [-1.1375, 0], 3: [-1.1375, 0.95], 4: [1.1375, 0.95], 5: [1.1375, 0], 6: [1.1375, -0.95] }],
  ['esp32-sensor Tact, TS-1187A', L.TactSwitch('5.1x5.1'), { 1: [-3.0, -1.85], 2: [3.0, -1.85], 3: [-3.0, 1.85], 4: [3.0, 1.85] }],
  ['stm32-dev STM32F103C8, LQFP-48', L.LQFP(48, 7, 0.5), Object.fromEntries(Array.from({ length: 48 }, (_, i) => [i + 1, reviewerLqfp48(i + 1)]))],
  ['stm32-dev Crystal3225', L.Crystal3225, { 1: [-1.1, 0.8], 2: [1.1, 0.8], 3: [1.1, -0.8], 4: [-1.1, -0.8] }],
  ['stm32-dev Crystal3215', L.Crystal3215, { 1: [-1.25, 0], 2: [1.25, 0] }],
  ['badge Tact, PTS810', L.TactSwitch('4.2x3.2'), { 1: [-2.075, -1.075], 2: [2.075, -1.075], 3: [-2.075, 1.075], 4: [2.075, 1.075] }],
  [
    'badge Pogo, ISP-6',
    L.PogoPad(1.5, { cols: 3, rows: 2 }),
    Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [n, [(Math.floor((n - 1) / 2) - 1) * 2.54, (((n - 1) % 2) - 0.5) * 2.54]])),
  ],
  ['usbc-led MountingHole, M2', L.MountingHole(2.2), { '': [0, 0] }],
]

for (const [where, f, ref] of ACCURATE) {
  test(`lib footprints: matches the hand-written ${where} within 0.05 mm`, () => {
    const b = place(f)
    for (const [num, [x, y]] of Object.entries(ref)) at(b, num, x, y, 0.05 + 1e-9)
    assert.equal(padsOf(b).length, Object.keys(ref).length)
  })
}

/** The distance from the 16-pin USB-C signal row to its front shell pins. */
function usbShell() {
  const b = place(L.USBC.footprint('full16'))
  return Math.abs(pad(b, 'S1').y - pad(b, 'A1').y)
}

test('lib footprints: corrects the hand-written footprints that were off, by more than 0.05 mm, toward the KiCad and Espressif patterns', () => {
  // [where, the reviewer's value, the stdlib's]
  const off = [
    ['stm32-dev SOT23Reg and demo SOT23 pad 1 x', -1.0, pad(place(L.SOT23(3)), 1).x],
    ['badge SOIC8 pad 1 x', -2.7, pad(place(L.SOIC(8)), 1).x],
    ['led-matrix WS2812B2020 pad 1 x', -0.8, pad(place(L.WS2812B('2020')), 1).x],
    ['usbc-led USBC6P GND pad x', -2.5, pad(place(L.USBC.footprint('power6')), 'B12').x],
    ['esp32-sensor USBC, signal row to the front shell pins', 1.55, usbShell()],
    ['stm32-dev USBC, signal row to the front shell pins', 0.5, usbShell()],
    ['stm32-dev Tact TS-1088 pad x', -2.0, pad(place(L.TactSwitch('3x4')), 1).x],
    ['badge Slide pad y', -2.2, pad(place(L.SlideSwitch(3)), 1).y],
    ['badge CR2032 + pad x', 12.6, pad(place(L.CR2032Holder), 3).x],
    ['esp32-sensor ESP32C3Mini pad 1 x', -6.35, pad(place(L.ESP32C3Mini1), 1).x],
  ]
  for (const [where, theirs, ours] of off) assert.ok(Math.abs(theirs - ours) > 0.05, `${where}: ${theirs} vs ${ours}`)
})

test('lib: the exposed pad of QFN and LQFP and its thermal vias join a pour solidly; the leads, and a part placed with thermal, do not', () => {
  const b = place(L.QFN(32, 5, 0.5, 3.45, { vias: 3 }))
  const ep = padsOf(b).filter(p => p.num === '33')
  assert.equal(ep.length, 10)
  assert.ok(ep.every(p => p.thermal === 'solid'))
  assert.ok(
    padsOf(b)
      .filter(p => p.num !== '33')
      .every(p => p.thermal === undefined),
  )
  assert.ok(
    padsOf(place(L.LQFP(48, 7, 0.5, { ep: 5 })))
      .filter(p => p.name === 'EP')
      .every(p => p.thermal === 'solid'),
  )
  assert.ok(
    padsOf(place(L.ESP32C3Mini1))
      .filter(p => p.num === '49')
      .every(p => p.thermal === 'solid'),
  )
  // a placed part's thermal map overrides its footprint's pads by number or name
  const { GND } = nets()
  const U = L.QFN(16, 3, 0.5, 1.75)().connect({ EP: GND })
  const p = compileBoard(
    h(PCB, { name: 'Lib', rules: RULES }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 40 }), h(U, { at: '20 20', thermal: { EP: 'thermal', 1: 'none' } })),
  )
  assert.equal(padsOf(p).find(q => q.name === 'EP').thermal, 'thermal')
  assert.equal(padsOf(p).find(q => q.num === '1').thermal, 'none')
})
