import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, pour, stitch, resetDefaults } from '@pcbjs/core'
import { compileBoard, CompileError } from '../dist/index.js'
import { intersection, polysToRings } from '../dist/geom.js'

const W = 30,
  H = 20
const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: W, h: H })
const box = `M0 0 H${W} V${H} H0 Z`
const board = (...kids) => {
  resetDefaults()
  return compileBoard(h(PCB, { name: 'S' }, outline(), ...kids), { routeCache: false })
}
/** a through-hole GND pad that holds both pours */
const anchor = () => h('footprint', { ref: 'J1', at: '2 2', 'net:1': 'GND' }, h('pad', { num: 1, size: 1.6, drill: 0.8 }))
const pours = () => [pour('GND', 'F.Cu', box), pour('GND', 'B.Cu', box)]
const stitched = b => b.items.filter(i => i.kind === 'via' && i.stitch)
const errors = b => b.drc.filter(d => d.severity === 'error')
const sq = ([x, y], r = 0.05) => [
  [x - r, y - r],
  [x + r, y - r],
  [x + r, y + r],
  [x - r, y + r],
]
const filled = (b, layer, p) => b.items.some(z => z.kind === 'zone' && z.layer === layer && polysToRings(intersection(polysToRings(z.fill), [sq(p)])).length > 0)

test('stitch: vias of the net on a pitch lattice where both pours have fill, joined to them, DRC clean', () => {
  const b = board(anchor(), ...pours(), stitch('GND', { pitch: 4, via: { drill: 0.3, size: 0.62 } }))
  const v = stitched(b)
  assert.ok(v.length >= 20 && v.length <= 40, `${v.length} vias`)
  for (const x of v) {
    assert.equal(x.net, 'GND')
    assert.deepEqual([x.drill, x.size, x.layers], [0.3, 0.62, ['F.Cu', 'B.Cu']])
    assert.ok(filled(b, 'F.Cu', x.at) && filled(b, 'B.Cu', x.at))
  }
  for (const a of v) for (const c of v) if (a !== c) assert.ok(Math.hypot(a.at[0] - c.at[0], a.at[1] - c.at[1]) >= 2 - 1e-9)
  assert.deepEqual(errors(b), [])
  assert.equal(b.unconnected, 0)
  assert.equal(b.stats.vias, v.length)
})

test('stitch: no via where a listed layer has no fill of the net; layers narrows the list and the via keeps clear of other copper', () => {
  const sig = h('track', { net: 'SIG', layer: 'F.Cu', width: 0.3, d: 'M1 10 L29 10' })
  const none = board(anchor(), pour('GND', 'B.Cu', box), sig, stitch('GND', { pitch: 3 }))
  assert.equal(stitched(none).length, 0, 'F.Cu has no GND fill')
  const b = board(anchor(), pour('GND', 'B.Cu', box), sig, stitch('GND', { pitch: 3, layers: ['B.Cu'] }))
  const v = stitched(b)
  assert.ok(v.length > 10, `${v.length} vias`)
  for (const x of v) assert.ok(Math.abs(x.at[1] - 10) - x.size / 2 - 0.15 >= b.rules.clearance - 1e-6, `via at ${x.at} near SIG`)
  assert.deepEqual(errors(b), [])
})

test('stitch: a via of the net suppresses the lattice points within the pitch, padClearance keeps vias off pads, area limits them', () => {
  const free = stitched(board(anchor(), ...pours(), stitch('GND', { pitch: 4 })))
  const hand = board(anchor(), ...pours(), h('via', { net: 'GND', at: '15 10' }), stitch('GND', { pitch: 4 }))
  for (const x of stitched(hand)) assert.ok(Math.hypot(x.at[0] - 15, x.at[1] - 10) >= 2 - 1e-9)
  assert.ok(stitched(hand).length < free.length)
  const pad = h('footprint', { ref: 'R1', at: '15 10', 'net:1': 'SIG' }, h('pad', { num: 1, size: [2, 2], type: 'smd' }))
  const kept = board(anchor(), ...pours(), pad, stitch('GND', { pitch: 2, padClearance: 1.5 }))
  // the pad is a 2 mm roundrect with 0.5 mm corners: its copper is the 1 mm square at its centre grown by 0.5
  const toPad = ([x, y]) => Math.hypot(Math.max(0, Math.abs(x - 15) - 0.5), Math.max(0, Math.abs(y - 10) - 0.5)) - 0.5
  assert.ok(stitched(kept).length > 10)
  for (const x of stitched(kept)) assert.ok(toPad(x.at) - x.size / 2 >= 1.5 - 0.005, `via at ${x.at}`)
  assert.ok(
    stitched(kept).some(x => toPad(x.at) - x.size / 2 < 1.6),
    'a via sits close to the limit',
  )
  const area = board(anchor(), ...pours(), stitch('GND', { pitch: 3, area: 'M 15 0 H 30 V 20 H 15 Z' }))
  assert.ok(stitched(area).length > 5)
  for (const x of stitched(area)) assert.ok(x.at[0] >= 15)
})

test('stitch: avoid.silk keeps vias off silk, and the pours refill around the vias they touch', () => {
  const silk = h('rect', { layer: 'F.SilkS', x: 8, y: 5, w: 14, h: 10, fill: true })
  const on = stitched(board(anchor(), ...pours(), silk, stitch('GND', { pitch: 3 })))
  assert.ok(on.some(x => x.at[0] > 8 && x.at[0] < 22 && x.at[1] > 5 && x.at[1] < 15))
  const off = stitched(board(anchor(), ...pours(), silk, stitch('GND', { pitch: 3, avoid: { silk: true } })))
  assert.ok(off.length > 0)
  for (const x of off) assert.ok(!(x.at[0] > 8 - 0.4 && x.at[0] < 22 + 0.4 && x.at[1] > 5 - 0.4 && x.at[1] < 15 + 0.4), `via at ${x.at} on silk`)
  // a SIG pour on In1.Cu of a four-layer board: through vias cut it, and it refills around them
  resetDefaults()
  const b = compileBoard(
    h(PCB, { name: 'S4', copper: 4 }, outline(), anchor(), ...pours(), pour('SIG', 'In1.Cu', box, { islands: 'keep' }), stitch('GND', { pitch: 4, layers: ['F.Cu', 'B.Cu'] })),
    { routeCache: false },
  )
  const v = stitched(b)
  assert.ok(v.length > 10)
  for (const x of v) assert.ok(!filled(b, 'In1.Cu', x.at), `In1.Cu fill under the via at ${x.at}`)
  assert.deepEqual(errors(b), [])
})

test('stitch: errors name the call', () => {
  assert.throws(() => board(stitch('GND', { layers: ['F.SilkS'] })), CompileError)
  assert.throws(() => board(stitch('GND', { pitch: 0 })), /pitch must be more than 0/)
  assert.throws(() => board(stitch('GND', { via: { drill: 0.6, size: 0.5 } })), /must be more than its drill/)
  assert.throws(() => board(h('footprint', { ref: 'U1', at: '5 5' }, stitch('GND'))), /board element/)
  assert.throws(() => board(stitch('GND', { area: 'M0 0 L1 1' })), /no closed area/)
})

test('stitch: grid and origin put every via on the owner grid, avoid.courtyard keeps them out of courtyards', () => {
  const v = stitched(board(anchor(), ...pours(), stitch('GND', { pitch: 5, grid: 0.635, origin: '0.1 0.2' })))
  assert.ok(v.length > 10, `${v.length} vias`)
  const on = (c, o) => Math.abs((c - o) / 0.635 - Math.round((c - o) / 0.635)) < 1e-3
  for (const x of v) assert.ok(on(x.at[0], 0.1) && on(x.at[1], 0.2), `via at ${x.at} off the grid`)
  assert.throws(() => board(stitch('GND', { grid: 0 })), /grid must be more than 0/)
  const part = h('footprint', { ref: 'U1', at: '15 10' }, h('rect', { layer: 'F.CrtYd', x: -4, y: -3, w: 8, h: 6, width: 0.05 }))
  const under = x => Math.abs(x.at[0] - 15) < 4 + x.size / 2 && Math.abs(x.at[1] - 10) < 3 + x.size / 2
  assert.ok(stitched(board(anchor(), ...pours(), part, stitch('GND', { pitch: 3 }))).some(under))
  const off = stitched(board(anchor(), ...pours(), part, stitch('GND', { pitch: 3, avoid: { courtyard: true } })))
  assert.ok(off.length > 10)
  assert.ok(!off.some(under), 'a via under the courtyard')
})

test('stitch: a call that places no via gives a stitch-empty info finding; a via in its own pour leaves the fill as it was', () => {
  const b = board(anchor(), pour('GND', 'B.Cu', box), stitch('GND', { pitch: 3 }))
  const f = b.drc.filter(d => d.rule === 'stitch-empty')
  assert.equal(f.length, 1)
  assert.equal(f[0].severity, 'info')
  assert.match(f[0].message, /no fill of the net on F\.Cu/)
  const plain = board(anchor(), ...pours())
  const s = board(anchor(), ...pours(), stitch('GND', { pitch: 4 }))
  assert.ok(stitched(s).length > 10)
  assert.equal(s.drc.filter(d => d.rule === 'stitch-empty').length, 0)
  const fills = x => x.items.filter(i => i.kind === 'zone').map(z => z.fill)
  assert.deepEqual(fills(s), fills(plain))
})
