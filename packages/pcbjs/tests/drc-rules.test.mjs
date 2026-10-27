import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { BASE } from '@pcbjs/lib/rules'

const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 })
const board = (...kids) => compileBoard(h(PCB, { name: 'D' }, outline(), ...kids))
const fp = (ref, at, ...kids) => h('footprint', { ref, at }, ...kids)
const marks = (b, rule) => b.drc.filter(d => d.rule === rule)
const only = (b, rule, n = 1) => {
  const m = marks(b, rule)
  assert.equal(m.length, n, `${rule}: ${JSON.stringify(b.drc.map(d => `${d.rule}: ${d.message}`))}`)
  return m
}

test('drc rules: a clean board with vias, a plated pad, a hole and silk has no markers', () => {
  const b = board(
    h('via', { at: '5 5' }), h('via', { at: '5 10' }),
    fp('J1', '12 5', h('pad', { num: 1, size: 1.7, drill: 1.0 })),
    fp('H1', '12 12', h('pad', { num: '', size: 2.2, drill: 2.2, type: 'npth' })),
    fp('R1', '5 15', h('pad', { num: 1, at: '-0.8 0', size: [0.9, 1.0] }), h('line', { layer: 'F.SilkS', x1: -0.2, y1: 0.75, x2: 0.2, y2: 0.75 })),
  )
  assert.deepEqual(b.drc.map(d => `${d.rule}: ${d.message}`), [])
})

test('drc rules: via-drill and via-size', () => {
  const b = board(h('via', { at: '5 5', drill: 0.2, size: 0.5 }))
  const [d] = only(b, 'via-drill')
  assert.equal(d.severity, 'error')
  assert.match(d.message, /^via has a 0.2 mm drill, minimum via drill 0.3 mm$/)
  assert.match(only(b, 'via-size')[0].message, /^via is 0.5 mm across, minimum via diameter 0.6 mm$/)
  only(b, 'drill', 0) // the via drill is reported once, as via-drill
})

test('drc rules: annular-ring on a via and on a plated pad', () => {
  const v = board(h('via', { at: '5 5', drill: 0.4, size: 0.65 }))
  assert.match(only(v, 'annular-ring')[0].message, /^via has a 0.125 mm annular ring \(0.65 mm copper, 0.4 mm drill\), minimum 0.15 mm$/)
  // an oval pad 2.4 x 1.3 around a 1.0 drill: the ring is measured on the smaller side
  const p = board(fp('J1', '10 10', h('pad', { num: 1, shape: 'oval', size: [2.4, 1.3], drill: 1.0 })))
  assert.match(only(p, 'annular-ring')[0].message, /^pad J1.1 has a 0.15 mm annular ring \(1.3 mm copper, 1 mm drill\), minimum 0.2 mm for plated pads$/)
})

test('drc rules: drill below minDrill on a pad', () => {
  const b = board(fp('H1', '10 10', h('pad', { num: '', size: 0.25, drill: 0.25, type: 'npth' })))
  assert.match(only(b, 'drill')[0].message, /^unplated hole of H1 at \(10, 10\) has a 0.25 mm drill, minimum drill 0.3 mm$/)
})

test('drc rules: hole-to-hole counts every drill, plated or not', () => {
  // via hole edge at 5.15, NPTH edge at 5.55: 0.4 mm apart
  const b = board(h('via', { at: '5 5' }), fp('H1', '6.05 5', h('pad', { num: '', size: 1.0, drill: 1.0, type: 'npth' })))
  const [m] = only(b, 'hole-to-hole')
  assert.match(m.message, /^holes of via and unplated hole of H1 at \(6.05, 5\) are 0.4 mm apart edge to edge, minimum 0.5 mm$/)
  assert.equal(m.severity, 'error')
  // a 2.0 x 0.8 slot reaches x = 11.0 along its length; turned 90 degrees it reaches 10.4
  const slot = rot => board(fp('J1', `10 10 ${rot}`, h('pad', { num: 1, shape: 'oval', size: [2.6, 1.4], drill: [2.0, 0.8] })), h('via', { at: '11.6 10' }))
  assert.match(only(slot(0), 'hole-to-hole')[0].message, /are 0.45 mm apart/)
  only(slot(90), 'hole-to-hole', 0)
})

test('drc rules: hole-to-copper flags other-net and no-net copper, not the same net', () => {
  // a GND track 0.2 mm from the hole edge of a SIG via passes the copper clearance but not the hole clearance
  const mk = net => board(
    h('via', { at: '5 5', net: 'SIG', drill: 0.3, size: 0.45 }),
    h('track', { net, layer: 'F.Cu', width: 0.2, d: 'M 5.45 3 V 7' }),
  )
  const b = mk('GND')
  const m = marks(b, 'hole-to-copper')
  assert.ok(m.length >= 1, JSON.stringify(b.drc.map(d => d.message)))
  assert.match(m[0].message, /^track GND \(GND\) is 0.2 mm from the hole of via SIG \(SIG\) on F.Cu, closer than 0.3 mm$/)
  assert.equal(marks(mk('SIG'), 'hole-to-copper').length, 0, 'same net is fine')
  // copper over the hole itself has no gap to measure
  assert.match(only(board(h('via', { at: '5 5', net: 'SIG', drill: 0.3, size: 0.45 }), h('track', { net: 'GND', layer: 'B.Cu', width: 0.2, d: 'M 3 5 H 7' })), 'hole-to-copper')[0].message, /^track GND \(GND\) covers the hole of via SIG/)
  // an NPTH has no net: copper of any net near it is flagged
  const n = board(fp('H1', '10 10', h('pad', { num: '', size: 1.0, drill: 1.0, type: 'npth' })), h('track', { net: 'A', layer: 'B.Cu', width: 0.2, d: 'M 10.65 8 V 12' }))
  assert.match(only(n, 'hole-to-copper')[0].message, /is 0.05 mm from unplated hole of H1 at \(10, 10\) \(no net\) on B.Cu, closer than 0.3 mm/)
})

test('drc rules: silk-width warns on thin silk graphics', () => {
  const b = board(h('line', { layer: 'F.SilkS', x1: 2, y1: 2, x2: 6, y2: 2, width: 0.1 }))
  const [m] = only(b, 'silk-width')
  assert.equal(m.severity, 'warning')
  assert.match(m.message, /^silk graphic on F.SilkS is 0.1 mm wide, minimum 0.15 mm$/)
})

test('drc rules: silk-over-pad warns when silk runs into a mask opening of the same side', () => {
  const mk = (side, y) => board(fp('R1', '10 10', h('pad', { num: 1, size: [1, 1], layers: [`${side}.Cu`] }), h('line', { layer: 'F.SilkS', x1: -1, y1: y, x2: 1, y2: y })))
  const [m] = only(mk('F', 0.5), 'silk-over-pad')
  assert.equal(m.severity, 'warning')
  assert.match(m.message, /^silk of R1 on F.SilkS runs into the mask opening of pad R1.1; the fab clips it$/)
  only(mk('B', 0.5), 'silk-over-pad', 0) // the pad is on the other side
  // the opening is the pad grown by maskExpansion: silk 0.03 mm off the copper is still inside it
  only(mk('F', 0.5 + 0.075 + 0.03), 'silk-over-pad', 1)
  only(mk('F', 0.5 + 0.075 + 0.06), 'silk-over-pad', 0)
})

test('drc rules: BASE holds the values the messages quote', () => {
  assert.equal(BASE.minViaDrill, 0.3)
  assert.equal(BASE.holeClearance, 0.3)
  assert.equal(BASE.minHoleToHole, 0.5)
})
