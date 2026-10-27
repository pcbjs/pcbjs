import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, pour, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { bbox, intersection, polysToRings } from '../dist/geom.js'
import { thermalReport } from '../dist/zones.js'
import { near } from './helpers.mjs'

const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 })
const board = (rules, ...kids) => { resetDefaults(); return compileBoard(h(PCB, { name: 'T', ...(rules ? { rules } : {}) }, outline(), ...kids)) }
const gnd = (connect) => pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z', connect ? { connect } : undefined)
/** a footprint with one GND pad at 10 10 and a second GND pad far away, so the net needs the pour */
const part = (pad, fpProps = {}) => h('footprint', { ref: 'U1', at: '10 10', 'net:1': 'GND', 'net:2': 'GND', ...fpProps },
  h('pad', { num: 1, size: [1, 1], ...pad }), h('pad', { num: 2, at: '-6 -6', size: [1, 1] }))
const zoneOf = b => b.items.find(i => i.kind === 'zone')
const padOf = (b, num) => b.items.find(i => i.kind === 'pad' && i.num === String(num))
const fillRings = b => polysToRings(zoneOf(b).fill)
const sq = (x, y, r = 0.02) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]]
const covered = (b, x, y) => polysToRings(intersection(fillRings(b), [sq(x, y)])).length > 0
const rules = b => b.drc.map(d => d.rule)
/** the width of copper across the line through x y perpendicular to the unit vector u, within 0.6 mm of the point */
function spokeWidth(b, x, y, u, L = 0.6) {
  const n = [-u[1], u[0]], t = 0.005
  const strip = [[x - n[0] * L - u[0] * t, y - n[1] * L - u[1] * t], [x + n[0] * L - u[0] * t, y + n[1] * L - u[1] * t], [x + n[0] * L + u[0] * t, y + n[1] * L + u[1] * t], [x - n[0] * L + u[0] * t, y - n[1] * L + u[1] * t]]
  const bb = bbox(polysToRings(intersection(fillRings(b), [strip])))
  return Math.abs(n[0]) > Math.abs(n[1]) ? bb.w : bb.h
}

for (const shape of ['circle', 'oval', 'rect', 'roundrect']) {
  test(`thermal: a ${shape} pad gets four 0.5 mm spokes along its axes across a 0.5 mm gap`, () => {
    const size = shape === 'oval' ? [1.6, 1] : shape === 'circle' ? 1.2 : [1.4, 1]
    const b = board(null, part({ shape, size }), gnd())
    const [hw, hh] = shape === 'circle' ? [0.6, 0.6] : size.map(v => v / 2)
    // the middle of the gap: copper on each axis, none on the diagonals
    for (const [x, y, u] of [[10 + hw + 0.25, 10, [1, 0]], [10 - hw - 0.25, 10, [1, 0]], [10, 10 + hh + 0.25, [0, 1]], [10, 10 - hh - 0.25, [0, 1]]]) {
      assert.ok(covered(b, x, y), `spoke at ${x} ${y}`)
      near(spokeWidth(b, x, y, u), 0.5, 0.01)
    }
    // the middle of the gap on the diagonal
    const [dx, dy] = shape === 'circle' ? [0.85 / Math.SQRT2, 0.85 / Math.SQRT2] : [hw + 0.25 / Math.SQRT2, hh + 0.25 / Math.SQRT2]
    assert.equal(covered(b, 10 + dx, 10 + dy), false, 'the gap is clear off the spokes')
    assert.equal(covered(b, 10 + hw + 0.25, 10 + 0.4), false, 'beside the right spoke')
    assert.deepEqual(thermalReport(zoneOf(b)).pads.map(p => p.spokes), [4, 4])
    assert.deepEqual(b.ratsnest, [], 'both pads join through their spokes')
    assert.deepEqual(rules(b), [])
  })
}

test('thermal: spokes turn with the pad, and angle 45 puts them between the axes', () => {
  const r = board(null, part({ shape: 'rect', size: [1, 1], at: '0 0 30' }), gnd())
  const a = (30 * Math.PI) / 180, t = 0.75
  assert.ok(covered(r, 10 + Math.cos(a) * t, 10 - Math.sin(a) * t), 'spoke along the turned x axis')
  assert.equal(covered(r, 10 + t, 10), false, 'none along the board x axis')
  const d = board({ thermal: { angle: 45 } }, part({ shape: 'circle', size: 1 }), gnd())
  const q = 0.75 / Math.SQRT2
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) assert.ok(covered(d, 10 + sx * q, 10 + sy * q))
  assert.equal(covered(d, 10.75, 10), false)
  assert.deepEqual(thermalReport(zoneOf(d)).pads.map(p => p.spokes), [4, 4])
})

test('thermal: rules set the gap, the spoke width and the count, merged over the defaults', () => {
  const b = board({ thermal: { gap: 0.3, spokes: 2, spokeWidth: 0.4 } }, part({ shape: 'circle', size: 1 }), gnd())
  assert.ok(covered(b, 10.65, 10)); assert.ok(covered(b, 9.35, 10))
  assert.equal(covered(b, 10, 10.65), false, 'two spokes only')
  near(spokeWidth(b, 10.65, 10, [1, 0], 0.4), 0.4, 0.01)
  assert.deepEqual(b.rules.thermal, { gap: 0.3, spokes: 2, spokeWidth: 0.4 })
  assert.throws(() => board({ thermal: { angle: 30 } }), /thermal.angle must be 90 or 45/)
  assert.throws(() => board({ thermal: { width: 1 } }), /thermal has no key "width"/)
})

test('thermal: connect solid and none on the pour, and the pad and footprint overrides', () => {
  const solid = board(null, part({ shape: 'rect' }), gnd('solid'))
  assert.ok(covered(solid, 10.6, 10.4) && covered(solid, 10.4, 10.4), 'solid: poured over the pad and its corner')
  assert.equal(thermalReport(zoneOf(solid)), undefined)
  const none = board(null, part({ shape: 'rect' }), gnd('none'))
  assert.equal(covered(none, 10.6, 10), false)
  assert.deepEqual(none.ratsnest.map(r => r.net), ['GND'], 'none: neither pad is joined, and the fill, an island then, is removed')
  assert.deepEqual(zoneOf(none).fill, [])
  const pad = board(null, part({ shape: 'rect', thermal: 'solid' }), gnd())
  assert.ok(covered(pad, 10.55, 10.45), 'a pad thermal solid wins over the pour')
  assert.deepEqual(thermalReport(zoneOf(pad)).pads.map(p => p.pad.num), ['2'])
  const fp = board(null, part({ shape: 'rect' }, { thermal: { 1: 'solid' } }), gnd())
  assert.ok(covered(fp, 10.55, 10.45), 'a footprint thermal map reaches its pad')
  const back = board(null, part({ shape: 'rect', thermal: 'thermal' }), gnd('solid'))
  assert.equal(covered(back, 10.55, 10.45), false, 'a pad thermal relief on a solid pour')
  assert.throws(() => board(null, part({}, { thermal: { 9: 'solid' } }), gnd()), /U1: thermal names pad "9"/)
  assert.throws(() => board(null, part({ thermal: 'spokes' }), gnd()), /<pad 1> thermal must be 'thermal', 'solid' or 'none', got "spokes"/)
  assert.throws(() => board(null, pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z', { connect: 'yes' })), /<zone> connect must be/)
})

test('thermal: vias and tracks of the net join solidly', () => {
  const b = board(null, h('via', { at: '5 15', net: 'GND' }), h('track', { net: 'GND', layer: 'F.Cu', width: 0.3, d: 'M14 4 L16 4' }), gnd())
  assert.ok(covered(b, 5.35, 15), 'fill reaches the via ring')
  assert.ok(covered(b, 16.2, 4), 'fill reaches the track end')
  assert.equal(thermalReport(zoneOf(b)), undefined)
})

// other-net tracks around the pad at 10 10 on the given sides, each cutting the spoke there
const fence = (...sides) => sides.map(s => h('track', { net: 'SIG', layer: 'F.Cu', width: 0.3,
  d: { right: 'M11.3 8.7 V11.3', left: 'M8.7 8.7 V11.3', up: 'M8.7 8.7 H11.3', down: 'M8.7 11.3 H11.3', upLong: 'M6.5 9.1 H11.3', downLong: 'M6.5 10.9 H11.3' }[s] }))

test('thermal: a pad with fewer connected spokes than minSpokes is the warning thermal-spokes', () => {
  // the long fences block the diagonal spokes too
  const b = board(null, part({ shape: 'rect' }), gnd(), ...fence('right', 'upLong', 'downLong'))
  const t = b.drc.filter(d => d.rule === 'thermal-spokes')
  assert.equal(t.length, 1, JSON.stringify(b.drc))
  assert.equal(t[0].severity, 'warning')
  assert.equal(t[0].message, 'pad U1.1 (GND) joins the GND pour on F.Cu through 1 of 4 thermal spokes, fewer than 2')
  assert.equal(covered(b, 9.25, 10), true, 'the left spoke is kept')
  assert.deepEqual(b.ratsnest.filter(r => r.net === 'GND'), [], 'connected through its one spoke')
  const ok = board({ thermal: { minSpokes: 1 } }, part({ shape: 'rect' }), gnd(), ...fence('right', 'upLong', 'downLong'))
  assert.deepEqual(ok.drc.filter(d => d.rule === 'thermal-spokes'), [])
})

test('thermal: when the axis spokes are blocked, the diagonal ones are tried before warning', () => {
  // right, up and down blocked on the axes leave one axis spoke; the two diagonals to the left reach the fill
  const b = board(null, part({ shape: 'rect' }), gnd(), ...fence('right', 'up', 'down'))
  assert.deepEqual(b.drc.filter(d => d.rule === 'thermal-spokes'), [])
  assert.deepEqual(thermalReport(zoneOf(b)).pads.map(p => p.spokes), [2, 4])
  const q = 0.5 + 0.25 / Math.SQRT2
  assert.equal(covered(b, 10 - q, 10 - q), true, 'the up-left diagonal spoke')
  assert.equal(covered(b, 10 - q, 10 + q), true, 'the down-left diagonal spoke')
  assert.equal(covered(b, 9.25, 10), false, 'the axis spoke is dropped with its set')
  assert.equal(b.drc.filter(d => d.rule === 'clearance' || d.rule === 'short').length, 0)
  // an unblocked pad keeps its axis spokes
  const free = board(null, part({ shape: 'rect' }), gnd())
  assert.equal(covered(free, 9.25, 10), true)
})

test('thermal: a through-hole pad joined solidly by a pour on another layer gives no thermal-spokes warning', () => {
  const tht = { shape: 'rect', size: [1, 1], drill: 0.5 }
  const bpour = pour('GND', 'B.Cu', 'M0 0 H20 V20 H0 Z', { connect: 'solid' })
  const warned = board(null, part(tht), gnd(), ...fence('right', 'upLong', 'downLong'))
  assert.equal(warned.drc.filter(d => d.rule === 'thermal-spokes').length, 1)
  const b = board(null, part(tht), gnd(), bpour, ...fence('right', 'upLong', 'downLong'))
  assert.deepEqual(b.drc.filter(d => d.rule === 'thermal-spokes'), [])
})

test('thermal: a pad with no spoke reaching the fill is unconnected from the pour', () => {
  const b = board(null, part({ shape: 'rect' }), gnd(), ...fence('right', 'left', 'up', 'down'))
  assert.deepEqual(thermalReport(zoneOf(b)).pads.map(p => p.spokes), [0, 4])
  assert.deepEqual(b.drc.filter(d => d.rule === 'thermal-spokes'), [])
  assert.equal(b.drc.filter(d => d.rule === 'unconnected' && /GND/.test(d.message)).length, 1)
  assert.equal(b.drc.filter(d => d.rule === 'clearance' || d.rule === 'short').length, 0, 'spokes keep clear of the fence')
  assert.deepEqual(b.ratsnest.map(r => r.net), ['GND'])
})

test('thermal: spokes thinner than the zone min width are kept, with the warning thermal-spoke-width', () => {
  const b = board({ thermal: { spokeWidth: 0.2 }, zoneMinWidth: 0.3 }, part({ shape: 'circle', size: 1 }), gnd())
  assert.deepEqual(thermalReport(zoneOf(b)).pads.map(p => p.spokes), [4, 4])
  near(spokeWidth(b, 10.75, 10, [1, 0]), 0.2, 0.01)
  const w = b.drc.filter(d => d.rule === 'thermal-spoke-width')
  assert.equal(w.length, 1)
  assert.equal(w[0].message, 'thermal spokes of the GND pour on F.Cu are 0.2 mm wide, narrower than its min width 0.3 mm; they are kept')
  assert.deepEqual(b.ratsnest, [])
})

test('thermal: a pad\'s own angle, its part\'s and the map turn its spokes over the rules\' angle', () => {
  const q = 0.75 / Math.SQRT2
  const diagonal = b => covered(b, 10 + q, 10 + q) && !covered(b, 10.75, 10)
  const axes = b => covered(b, 10.75, 10) && !covered(b, 10 + q, 10 + q)
  const own = board(null, part({ shape: 'circle', size: 1, thermal: { angle: 45 } }), gnd())
  assert.ok(diagonal(own))
  assert.equal(padOf(own, 1).thermalAngle, 45)
  assert.ok(covered(own, 4.75, 4), 'the other pad keeps the rules\' 90')
  assert.ok(axes(board({ thermal: { angle: 45 } }, part({ shape: 'circle', size: 1, thermal: { angle: 90 } }), gnd())), 'the pad over the rules')
  assert.ok(diagonal(board(null, part({ shape: 'circle', size: 1 }, { rules: { thermal: { angle: 45 } } }), gnd())), 'the footprint\'s rules')
  assert.ok(diagonal(board(null, part({ shape: 'circle', size: 1 }, { thermal: { 1: { angle: 45 } } }), gnd())), 'the map')
  const solid = board(null, part({ shape: 'circle', size: 1, thermal: { connect: 'solid', angle: 45 } }), gnd())
  assert.equal(padOf(solid, 1).thermal, 'solid')
  assert.throws(() => board(null, part({ shape: 'circle', size: 1, thermal: { angle: 30 } }), gnd()), /thermal angle must be 90 or 45, got 30/)
  assert.throws(() => board(null, part({ shape: 'circle', size: 1 }, { rules: { thermal: { angle: 60 } } }), gnd()), /thermal angle must be 90 or 45/)
})
