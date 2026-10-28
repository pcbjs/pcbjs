// Every standard library footprint on an empty board of every fab preset: no DRC or ERC finding, so nothing in @pcbjs/lib
// fails a preset's rules before the first track. Also the generators' argument checks and the namespace form of nets().
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB0, { h, nets, NC } from '@pcbjs/core'
import * as L from '@pcbjs/lib'
import { FABS } from '@pcbjs/fab/index'
import { compileBoard } from '@pcbjs/compile'

const AT = '25 25'

// static factories found by their metadata, then one or more instances of each generator
const STATIC = Object.entries(L).filter(([, v]) => typeof v === 'function' && Array.isArray(v.pins) && typeof v.prefix === 'string')
const GENERATED = [
  ['SOT23(3)', L.SOT23(3)],
  ['SOT23(5)', L.SOT23(5)],
  ['SOT23(6)', L.SOT23(6)],
  ['SOIC(8)', L.SOIC(8)],
  ['SOIC(16, W)', L.SOIC(16, 'W')],
  ['TSSOP(20)', L.TSSOP(20)],
  ['QFN(16, 3, 0.5, 1.75)', L.QFN(16, 3, 0.5, 1.75)],
  ['QFN(32, 5, 0.5, 3.45, vias 3)', L.QFN(32, 5, 0.5, 3.45, { vias: 3 })],
  ['QFN(28, 5, 0.5)', L.QFN(28, 5, 0.5)],
  ['LQFP(48, 7, 0.5)', L.LQFP(48, 7, 0.5)],
  ['LQFP(64, 10, 0.5)', L.LQFP(64, 10, 0.5)],
  ['LQFP(32, 7, 0.8)', L.LQFP(32, 7, 0.8)],
  ['USBC(full16)', L.USBC.footprint('full16')],
  ['USBC(power6)', L.USBC.footprint('power6')],
  ['JST_PH(4)', L.JST_PH.footprint(4)],
  ['JST_PH(3, side)', L.JST_PH.footprint(3, 'side')],
  ['JST_XH(2)', L.JST_XH.footprint(2)],
  ['PinSocket(4)', L.PinSocket.footprint(4)],
  ['PinSocket(3, rows 2)', L.PinSocket.footprint(3, { rows: 2 })],
  ['TestPad()', L.TestPad()],
  ['PogoPad(1.5, 3 x 2)', L.PogoPad(1.5, { cols: 3, rows: 2 })],
  ['MountingHole()', L.MountingHole()],
  ['MountingHole(3.2, pad)', L.MountingHole(3.2, true)],
  ['BatteryPads()', L.BatteryPads()],
  ['BatteryPads(SMD)', L.BatteryPads({ drill: 0 })],
  ...['6x6', '5.1x5.1', '4.5x4.5', '4.2x3.2', '3x4'].map(s => [`TactSwitch(${s})`, L.TactSwitch(s)]),
  ['SlideSwitch()', L.SlideSwitch()],
  ['WS2812B(2020)', L.WS2812B('2020')],
  ['WS2812B(5050)', L.WS2812B('5050')],
  ["LED('0402', 'red')", L.LED('0402', 'red')],
]
const HEADERS = [
  [1, 2.54],
  [2, 2.54],
  [1, 1.27],
  [2, 1.27],
].map(([rows, pitch]) => [`PinHeader(10, rows ${rows}, pitch ${pitch})`, () => L.PinHeader(10, { rows, pitch })])

function partOf(f) {
  if (typeof f === 'function' && !Array.isArray(f.pins) && typeof f.pins !== 'function') return f()
  const pins = typeof f.pins === 'function' ? f.pins({}) : f.pins
  const { GND } = nets()
  return pins.length ? f().connect(Object.fromEntries(pins.map(p => [p, p === 'EP' ? GND : NC]))) : null
}

const ALL = [
  ...STATIC.map(([n, f]) => [n, () => partOf(f), f]),
  ...GENERATED.map(([n, f]) => [n, () => partOf(f), f]),
  ...HEADERS.map(([n, mk]) => [
    n,
    () => {
      const p = mk()
      return p.connect(...p.pins.map(() => NC))
    },
    null,
  ]),
]

for (const path of FABS) {
  test(`lib presets: every stdlib footprint is DRC and ERC clean on an empty ${path} board`, async () => {
    const PCB = (await import(`@pcbjs/fab/${path}`)).default
    const bad = []
    for (const [label, make, f] of ALL) {
      const part = make()
      const node = part ? h(part, { at: AT }) : h(f, { ref: 'H1', at: AT })
      const b = compileBoard(h(PCB, { name: 'Lib' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 50, h: 50 }), node), { routeCache: false })
      for (const d of [...b.drc, ...b.erc]) if (!['single-pad', 'single-pin-net'].includes(d.rule)) bad.push(`${label}: ${d.severity} ${d.rule}: ${d.message}`)
    }
    assert.deepEqual(bad, [])
  })
}

test('lib presets: the 1.27 mm header has a 0.2 mm ring, at least JLCPCB minPadAnnularRing', () => {
  const b = compileBoard(
    h(PCB0, { name: 'H' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 50, h: 50 }), h(L.PinHeader(2, { pitch: 1.27, rows: 2 }).connect(NC, NC, NC, NC), { at: AT })),
    { routeCache: false },
  )
  for (const p of b.items.filter(i => i.kind === 'pad')) assert.ok((p.size[0] - p.drill[0]) / 2 >= 0.18 - 1e-9, `ring of pad ${p.num}`)
})

test('lib presets: generators name the parameter and its form when an argument is wrong', () => {
  assert.throws(() => L.QFN(28, 5, 0.5, true), /QFN: ep, the fourth argument and the exposed pad, must be a size in mm, one number or \[w, h\], got true/)
  assert.throws(() => L.QFN(32, 5, 0.5, { vias: 3 }), /QFN: ep.*got \{"vias":3\}.*options fifth/)
  assert.throws(() => L.QFN(32, 5, 0.5, 3.45, { via: 3 }), /QFN: unknown option "via"/)
  assert.throws(() => L.QFN(32, '5', 0.5), /QFN: size, the second argument and the body side, must be a positive number of mm, got "5"/)
  assert.throws(() => L.LQFP(48, 7, 0.5, { ep: 'big' }), /LQFP: ep, the exposed pad, must be a size in mm/)
  assert.throws(() => L.SOIC(8, 'N', []), /SOIC: the third argument, the options, must be an object/)
  assert.throws(() => L.SOT23(5, { pinNames: 'VIN' }), /SOT23_5: pinNames must be a list/)
  assert.throws(() => L.PinHeader(10, { pitch: '1.27' }), /PinHeader: pitch must be a positive number of mm/)
  assert.throws(() => L.PinHeader(10, { rows: 3 }), /PinHeader: rows must be 1, 2/)
  assert.throws(() => L.JST_PH.footprint('4'), /JST_PH: the count must be a whole number from 2 to 16, got "4"/)
  assert.throws(() => L.BatteryPads({ dia: -1 }), /BatteryPads: dia must be a positive number/)
  assert.throws(() => L.MountingHole(3.2, 'yes'), /MountingHole: pad, the second argument, must be true/)
  assert.throws(() => L.LED('0603', 5), /LED: the colour/)
  assert.throws(() => L.PogoPad(1.5, { pitch: 0 }), /PogoPad: pitch must be a positive number/)
})

test('lib presets: silkOutline takes pads as bare geometry', () => {
  const s = L.silkOutline(4, 4, { pads: [{ x: -2, y: 0, w: 1, h: 1 }] })
  assert.ok(s)
})

test('nets: a string first is a namespace prefix, so four connectors keep four CC1 nets', () => {
  const a = nets('P1'),
    b = nets('P2'),
    plain = nets()
  assert.equal(a.CC1.name, 'P1/CC1')
  assert.equal(b.CC1.name, 'P2/CC1')
  assert.notEqual(a.CC1.name, b.CC1.name)
  assert.equal(plain.CC1.name, 'CC1')
  assert.equal(a.CC1, a.CC1)
  assert.equal(nets('P3/', { VBUS: { class: 'power' } }).VBUS.class, 'power')
  assert.equal(nets('P3', { VBUS: { class: 'power' } }).VBUS.name, 'P3/VBUS')
  assert.throws(() => nets(''), /nets\(""\): the namespace prefix must be a non-empty name/)
  assert.throws(() => nets({ VIN: 'power' }), /the entry "VIN" must be \{ class: 'name' \}/)
  assert.throws(() => nets({}, {}), /a second argument follows only a prefix/)
  assert.throws(() => nets(3), /takes a namespace prefix string or a class table/)
})

test('drc: silk-over-edge warns with the overhang, and silk inside the outline passes', () => {
  const edge = h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 10 })
  const b = compileBoard(h(PCB0, { name: 'S' }, edge, h('text', { layer: 'F.SilkS', at: [18, 5], size: 1 }, 'REV 0.1.0')), { routeCache: false })
  const f = b.drc.filter(d => d.rule === 'silk-over-edge')
  assert.equal(f.length, 1)
  assert.equal(f[0].severity, 'warning')
  assert.match(f[0].message, /text "REV 0.1.0" on F.SilkS runs [\d.]+ mm past the board edge/)
  const ok = compileBoard(h(PCB0, { name: 'S' }, edge, h('text', { layer: 'F.SilkS', at: [10, 5], size: 1 }, 'REV')), { routeCache: false })
  assert.deepEqual(
    ok.drc.filter(d => d.rule === 'silk-over-edge'),
    [],
  )
  // silk inside a cutout is outside the board too
  const cut = compileBoard(h(PCB0, { name: 'S' }, edge, h('rect', { layer: 'Edge.Cuts', x: 8, y: 3, w: 4, h: 4 }), h('line', { layer: 'F.SilkS', x1: 5, y1: 5, x2: 15, y2: 5 })), {
    routeCache: false,
  })
  assert.equal(cut.drc.filter(d => d.rule === 'silk-over-edge').length, 1)
})

test('erc: impedance-width warns when a solved width is more than twice the start pad', async () => {
  const PCB2 = (await import('@pcbjs/fab/JLCPCB/2-Layer')).default
  const { route } = await import('@pcbjs/core')
  const { A } = nets()
  const pad = (ref, x) => h('footprint', { ref, at: [x, 10], nets: { 1: A } }, h('pad', { num: 1, size: [0.3, 0.6], type: 'smd' }))
  const b = compileBoard(h(PCB2, { name: 'Z' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 }), pad('J1', 5), pad('J2', 25), route('J1.1', 'J2.1').impedance(50)), {
    routeCache: false,
  })
  const f = b.erc.filter(d => d.rule === 'impedance-width')
  assert.equal(f.length, 1)
  assert.match(f[0].message, /the route of net A, 50 ohms, solves to 2\.8 mm tracks on F\.Cu, more than twice the 0\.3 mm pad J1\.1/)
})
