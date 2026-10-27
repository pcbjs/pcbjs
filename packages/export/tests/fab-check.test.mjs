// The Gerber self check: nested pours at three depths, cutouts drawn either way, and both review bugs caught with their fix off.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, keepout, nets, pour, resetDefaults } from '@pcbjs/core'
import { PinHeader, rect, circle } from '@pcbjs/lib'
import { compileBoard } from '@pcbjs/compile'
import { fillZones } from '@pcbjs/compile/zones'
import { area, intersection, polysToRings } from '@pcbjs/compile/geom'
import { circleRing } from '@pcbjs/compile/path'
import { buildFab, checkFab, gerberLayer, readGerber, modelCopper } from '../dist/index.js'

const DATE = '2026-01-01T00:00:00.000Z'
const mismatches = b => b.drc.filter(d => d.rule === 'fab-mismatch')

/** The island board of the PSU review, a VIN pour inside a hole of the GND pour, with two VIN pins the pour alone joins. */
function island() {
  const { GND, VIN } = nets()
  const J1 = PinHeader(1).connect(VIN), J2 = PinHeader(1).connect(VIN), J3 = PinHeader(1).connect(GND)
  return compileBoard(h(PCB, { name: 'Island' },
    h('path', { layer: 'Edge.Cuts', d: rect(20, 20) }),
    h(J1, { at: '8 8' }), h(J2, { at: '12 8' }), h(J3, { at: '3 3' }),
    pour(VIN, 'F.Cu', rect(8, 4, 6, 6), { priority: 1 }),
    pour(GND, 'F.Cu', rect(20, 20))))
}

/** Pours nested three deep: GND around A around B around C, each in a hole of the one outside it. */
function nested() {
  const { GND, A, B, C } = nets()
  const J1 = PinHeader(4).connect(GND, A, B, C)
  return compileBoard(h(PCB, { name: 'Nest' },
    h('path', { layer: 'Edge.Cuts', d: rect(40, 40) }),
    h(J1, { at: '20 4' }),
    // the inner pours touch no pad of their nets: kept as islands, the nesting is what this board tests
    pour(C, 'F.Cu', rect(4, 4, 18, 18), { priority: 3, islands: 'keep' }),
    pour(B, 'F.Cu', rect(12, 12, 14, 14), { priority: 2, islands: 'keep' }),
    pour(A, 'F.Cu', rect(20, 20, 10, 10), { priority: 1, islands: 'keep' }),
    pour(GND, 'F.Cu', rect(40, 40))))
}

/** The cutout board of the PSU review, the 6 mm hole drawn clockwise on screen or, with `ccw`, the other way. */
function cutout(ccw) {
  const { GND, VIN } = nets()
  const J1 = PinHeader(2).connect(VIN, GND)
  const hole = ccw ? 'M 7 10 A 3 3 0 0 0 13 10 A 3 3 0 0 0 7 10 Z' : 'M 7 10 A 3 3 0 0 1 13 10 A 3 3 0 0 1 7 10 Z'
  return compileBoard(h(PCB, { name: 'Cut' },
    h('path', { layer: 'Edge.Cuts', d: rect(20, 20) }),
    h('path', { layer: 'Edge.Cuts', d: hole }),
    h(J1, { at: '3 3' }),
    pour(GND, 'F.Cu', rect(20, 20))))
}

/** The F.Cu copper area within `r` of (10, 10), read back from the Gerber. */
function copperNear(b, r) {
  const g = readGerber(gerberLayer(b, 'F.Cu', DATE).text)
  return g.polys.flatMap(p => p.outer).filter(([x, y]) => Math.hypot(x - 10, y - 10) < r).length
}

test('nesting: an island in a pour hole survives in the Gerber, parent written before it', () => {
  resetDefaults()
  const b = island()
  const fab = buildFab(b, DATE, { check: true })
  assert.deepEqual(mismatches(b), [])
  assert.match(fab.readme, /Gerber self check: passed/)
  const g = readGerber(fab.files['Island-F_Cu.gtl'])
  const vin = b.items.find(i => i.kind === 'zone' && i.net === 'VIN')
  const fill = Math.abs(area(polysToRings(vin.fill)))
  assert.ok(fill > 20, `VIN fill ${fill}`)
  // the read back copper covers the whole model copper of the layer
  near(Math.abs(area(polysToRings(g.polys))), Math.abs(area(polysToRings(modelCopper(b, 'F.Cu')))), 0.01)
})

test('nesting: three depths of pours read back as the model draws them', () => {
  resetDefaults()
  const b = nested()
  const zones = b.items.filter(i => i.kind === 'zone')
  assert.equal(zones.length, 4)
  for (const z of zones) assert.ok(z.fill.length, `${z.net} filled`)
  buildFab(b, DATE, { check: true })
  assert.deepEqual(mismatches(b), [])
  const text = gerberLayer(b, 'F.Cu', DATE).text
  // four dark and three clear switches at least: GND, its hole, A, its hole, B, its hole, C
  assert.ok((text.match(/%LPC\*%/g) ?? []).length >= 3)
})

test('nesting: written in list order, the old bug, the self check fails with fab-mismatch on F.Cu', () => {
  resetDefaults()
  for (const make of [island, nested]) {
    const b = make()
    const fab = buildFab(b, DATE, { check: true, nest: false })
    const m = mismatches(b)
    assert.ok(m.length >= 1, `${b.name}: the check caught it`)
    assert.ok(m.some(f => f.layer === 'F.Cu' && /differs from the board's copper/.test(f.message)), m.map(f => f.message).join('\n'))
    if (make === island) assert.ok(m.some(f => /net VIN: pad J\d\.1 is no longer joined/.test(f.message)), m.map(f => f.message).join('\n'))
    assert.match(fab.readme, /STATUS: NOT ORDERABLE/)
    assert.match(fab.readme, /Gerber self check: FAILED/)
  }
})

test('cutouts: drawn either way, the copper keeps the same clearance from the hole', () => {
  resetDefaults()
  const cw = cutout(false), ccw = cutout(true)
  for (const b of [cw, ccw]) {
    assert.equal(b.drc.filter(d => d.severity === 'error').length, 0, b.drc.map(d => d.message).join('\n'))
    assert.equal(copperNear(b, 3.2), 0, 'no copper within the hole and its clearance')
    buildFab(b, DATE, { check: true })
    assert.deepEqual(mismatches(b), [])
  }
  const z = b => b.items.find(i => i.kind === 'zone').fill
  near(Math.abs(area(polysToRings(z(cw)))), Math.abs(area(polysToRings(z(ccw)))), 1e-6)
})

test('cutouts: oriented as drawn, the old bug, the self check fails with copper inside the cutout', () => {
  resetDefaults()
  const b = cutout(false)
  // undo the fix: give the cutout the outline's direction again and refill
  const outer = b.outline.reduce((x, y) => (Math.abs(area([y])) > Math.abs(area([x])) ? y : x))
  b.outline = b.outline.map(r => (r === outer || Math.sign(area([r])) === Math.sign(area([outer])) ? r : r.slice().reverse()))
  fillZones(b)
  const g = readGerber(gerberLayer(b, 'F.Cu', DATE).text)
  assert.ok(Math.abs(area(polysToRings(intersection(polysToRings(g.polys), [circleRing(10, 10, 2.9)])))) > 0.01, 'copper inside the hole')
  buildFab(b, DATE, { check: true })
  const m = mismatches(b)
  assert.ok(m.some(f => f.layer === 'F.Cu' && /outside the board outline or inside a cutout/.test(f.message)), m.map(f => f.message).join('\n'))
  const f = m.find(f => /cutout/.test(f.message))
  assert.ok(Math.hypot(f.at[0] - 10, f.at[1] - 10) < 3, `located at the hole: ${f.at}`)
})

test('cutouts: a cutout across the outline is a cutout-outside error', () => {
  resetDefaults()
  const b = compileBoard(h(PCB, { name: 'Cross' },
    h('path', { layer: 'Edge.Cuts', d: rect(20, 20) }),
    h('path', { layer: 'Edge.Cuts', d: circle(6, 20, 10) })))
  const e = b.drc.filter(d => d.rule === 'cutout-outside')
  assert.equal(e.length, 1)
  assert.equal(e[0].severity, 'error')
  assert.match(e[0].message, /crosses the board outline/)
})

test('silk: the legend is cleared from the mask openings it overlaps, and only there', () => {
  resetDefaults()
  const { A, B } = nets()
  const J1 = PinHeader(2).connect(A, B)
  const b = compileBoard(h(PCB, { name: 'Silk' },
    h('path', { layer: 'Edge.Cuts', d: rect(20, 20) }),
    h(J1, { at: '10 10' }),
    h('path', { layer: 'F.SilkS', d: 'M 2 10 H 18', width: 0.15 }),
    h('path', { layer: 'B.SilkS', d: 'M 2 2 H 18', width: 0.15 })))
  const f = gerberLayer(b, 'F.SilkS', DATE).text, bk = gerberLayer(b, 'B.SilkS', DATE).text
  assert.match(f, /%LPC\*%\nG36\*/)
  assert.doesNotMatch(bk, /%LPC/)
  // the opening of pad 1, which the line crosses, cleared; pad 2 stays out
  assert.equal((f.slice(f.indexOf('%LPC*%')).match(/G36\*/g) ?? []).length, 1)
  assert.match(f, /%LPD\*%\nM02\*/)
})

function near(a, b, tol) { assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`) }

/** A GND pour on F.Cu split in two by a pour keepout down the middle, a GND pad on the left and, with `right`, one on the right. */
function split({ right = true, track = null } = {}) {
  resetDefaults()
  const pad = (ref, x) => h('footprint', { ref, at: `${x} 10`, 'net:1': 'GND' }, h('pad', { num: 1, size: [1, 1] }))
  return compileBoard(h(PCB, { name: 'Split' },
    h('path', { layer: 'Edge.Cuts', d: rect(20, 20) }),
    pad('U1', 4), right ? pad('U2', 16) : null,
    keepout('F.Cu', rect(2, 20, 9, 0), { tracks: false, vias: false }),
    track ? h('track', { net: 'GND', layer: 'F.Cu', width: 0.3, d: track }) : null,
    pour('GND', 'F.Cu', rect(20, 20))), { routeCache: false })
}

test('pieces: a pour cut in two with a pad in each is unconnected, each piece named, and the self check agrees', () => {
  const b = split()
  const z = b.items.find(i => i.kind === 'zone')
  assert.equal(z.fill.length, 2, 'both pieces hold a pad, both stay')
  assert.equal(b.unconnected, 1)
  const f = b.drc.filter(d => d.rule === 'unconnected')
  assert.equal(f.length, 1)
  assert.match(f[0].message, /net GND is not fully connected: U\d\.1 in the F\.Cu pour piece at \(\d+\.\d\d, \d+\.\d\d\), \d+\.\d\d mm², is apart from U\d\.1 in the F\.Cu pour piece at/)
  // the Gerbers part the two pads as the DRC does: the self check finds nothing to report
  const fab = buildFab(b, DATE, { check: true })
  assert.deepEqual(mismatches(b), [])
  assert.match(fab.readme, /Gerber self check: passed/)
})

test('pieces: island removal keeps a piece joined to a pad through a track, drops one a dangling track alone touches', () => {
  // no pad on the right: the right piece goes
  const bare = split({ right: false })
  assert.equal(bare.items.find(i => i.kind === 'zone').fill.length, 1)
  assert.equal(bare.unconnected, 0)
  // a GND track from U1 across the keepout into the right piece holds it, and joins it
  const joined = split({ right: false, track: 'M4 10 H15' })
  const z = joined.items.find(i => i.kind === 'zone')
  assert.equal(z.fill.length, 2)
  assert.equal(z.islandsRemoved, undefined)
  assert.equal(joined.unconnected, 0)
  // a track wholly inside the right piece leads to no pad: the piece goes, and the track is a net island of its own
  const dangling = split({ right: false, track: 'M13 10 H17' })
  const zd = dangling.items.find(i => i.kind === 'zone')
  assert.equal(zd.fill.length, 1)
  assert.equal(zd.islandsRemoved.count, 1)
  assert.equal(dangling.unconnected, 1)
})
