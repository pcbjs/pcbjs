import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, pour, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { intersection, polysToRings } from '../dist/geom.js'

const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 })
const board = (rules, ...kids) => {
  resetDefaults()
  return compileBoard(h(PCB, { name: 'I', ...(rules ? { rules } : {}) }, outline(), ...kids), { routeCache: false })
}
const zoneOf = b => b.items.find(i => i.kind === 'zone')
const sq = (x, y, r = 0.02) => [
  [x - r, y - r],
  [x + r, y - r],
  [x + r, y + r],
  [x - r, y + r],
]
const covered = (b, x, y) => polysToRings(intersection(polysToRings(zoneOf(b).fill), [sq(x, y)])).length > 0
/** a GND pad on the left half only, and a SIG track across the whole board that splits the pour in two */
const split = () => [
  h('footprint', { ref: 'U1', at: '4 10', 'net:1': 'GND' }, h('pad', { num: 1, size: [1, 1] })),
  h('track', { net: 'SIG', layer: 'F.Cu', width: 0.5, d: 'M10 -1 L10 21' }),
]

test('islands: a pour drops the pieces that touch no pad, via or track of its net, by default', () => {
  const b = board(null, ...split(), pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z'))
  const z = zoneOf(b)
  assert.equal(z.fill.length, 1)
  assert.ok(covered(b, 5, 5) && !covered(b, 15, 5), 'the left piece holds the pad, the right one is gone')
  assert.equal(z.islandsRemoved.count, 1)
  assert.ok(z.islandsRemoved.area > 150 && z.islandsRemoved.area < 200, `${z.islandsRemoved.area} mm2`)
  // a via of the net on the right holds that piece too
  const v = board(null, ...split(), h('via', { net: 'GND', at: '15 15' }), pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z'))
  assert.equal(zoneOf(v).fill.length, 2)
  assert.equal(zoneOf(v).islandsRemoved, undefined)
})

test('islands: keep, minArea, and the rules default under the pour', () => {
  const keep = board(null, ...split(), pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z', { islands: 'keep' }))
  assert.equal(zoneOf(keep).fill.length, 2)
  const big = board(null, ...split(), pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z', { islands: { minArea: 100 } }))
  assert.equal(zoneOf(big).fill.length, 2, 'a piece above minArea stays')
  const small = board(null, ...split(), pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z', { islands: { minArea: 500 } }))
  assert.equal(zoneOf(small).fill.length, 1)
  const rules = board({ islands: 'keep' }, ...split(), pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z'))
  assert.equal(zoneOf(rules).fill.length, 2, 'the rules keep them')
  const own = board({ islands: 'keep' }, ...split(), pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z', { islands: 'remove' }))
  assert.equal(zoneOf(own).fill.length, 1, "the pour's own mode wins")
  assert.throws(() => board(null, pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z', { islands: 'drop' })), /<zone>: islands must be 'remove', 'keep' or \{ minArea \}/)
  assert.throws(() => board({ islands: { minArea: -1 } }), /islands must be/)
})

test('islands: a piece holding a pad or via stays, a fenced-in one goes', () => {
  // two GND pads, one each side: each piece holds a pad, so both stay and the net is open across the SIG track
  const b = board(null, ...split(), h('footprint', { ref: 'U2', at: '16 10', 'net:1': 'GND' }, h('pad', { num: 1, size: [1, 1] })), pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z'))
  assert.equal(zoneOf(b).fill.length, 2)
  // a piece fenced in by another net's copper: removed, and back with a via of the net inside it
  const fence = h('track', { net: 'SIG', layer: 'F.Cu', width: 0.3, d: 'M7 7 H13 V13 H7 Z' })
  const gnd = h('footprint', { ref: 'U1', at: '3 3', 'net:1': 'GND' }, h('pad', { num: 1, size: [1, 1] }))
  const fenced = board(null, fence, gnd, pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z'))
  assert.ok(!covered(fenced, 10, 10) && covered(fenced, 3, 10))
  assert.equal(zoneOf(fenced).islandsRemoved.count, 1)
  const held = board(null, fence, gnd, h('via', { net: 'GND', at: '10 10' }), pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z'))
  assert.ok(covered(held, 10, 11))
})
