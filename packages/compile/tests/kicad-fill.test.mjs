// Pour and mask details where pcbjs follows KiCad: own-net tracks count as spokes, a spoke landing in another pad's spoke is
// kept, a neck between keepouts narrower than the min width goes, and every non-plated hole opens the mask.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, pour, keepout, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { area, intersection, polysToRings } from '../dist/geom.js'
import { thermalReport } from '../dist/zones.js'
import { near } from './helpers.mjs'

const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 })
const board = (...kids) => {
  resetDefaults()
  return compileBoard(h(PCB, { name: 'T' }, outline(), ...kids))
}
const gnd = () => pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z')
// pour keepouts that let tracks through
const block = d => keepout('F.Cu', d, { tracks: false, vias: false })
const gndPad = (ref, at) => h('footprint', { ref, at, 'net:1': 'GND' }, h('pad', { num: 1, shape: 'rect', size: [1, 1] }))
const zoneOf = b => b.items.find(i => i.kind === 'zone')
const spokeWarnings = b => b.drc.filter(d => d.rule === 'thermal-spokes').map(d => d.message)

// the pad at 10 10 sees the pour only to its right, in a band 1.2 mm high: above, below and to the left it is kept out
const oneSide = () => [block('M 2 2 H 18 V 9.4 H 2 Z'), block('M 2 10.6 H 18 V 18 H 2 Z'), block('M 2 9.4 H 9 V 10.6 H 2 Z')]

test("thermal-spokes: a track of the pad's own net leaving it counts as a spoke", () => {
  const lone = board(gnd(), ...oneSide(), gndPad('U1', '10 10'), gndPad('U2', '16 16'))
  assert.equal(thermalReport(zoneOf(lone)).pads.find(p => p.pad.ref === 'U1').spokes, 1)
  assert.deepEqual(spokeWarnings(lone), ['pad U1.1 (GND) joins the GND pour on F.Cu through 1 of 4 thermal spokes, fewer than 2'])
  const tracked = board(gnd(), ...oneSide(), gndPad('U1', '10 10'), gndPad('U2', '16 16'), h('track', { net: 'GND', layer: 'F.Cu', width: 0.3, d: 'M 10 10 H 4' }))
  assert.deepEqual(spokeWarnings(tracked), [])
  // a track of another layer does not count
  const back = board(gnd(), ...oneSide(), gndPad('U1', '10 10'), gndPad('U2', '16 16'), h('track', { net: 'GND', layer: 'B.Cu', width: 0.3, d: 'M 10 10 H 4' }))
  assert.equal(spokeWarnings(back).length, 1)
})

test("thermal: a spoke whose far end lies in another pad's spoke is kept, as KiCad keeps it", () => {
  // two pads 1.9 mm apart in a corridor 1 mm wide: their gaps meet, so no fill lies between them, and only the spokes along
  // the corridor reach the fill
  const b = board(gnd(), block('M 2 2 H 9.5 V 18 H 2 Z'), block('M 10.5 2 H 18 V 18 H 10.5 Z'), gndPad('U1', '10 7'), gndPad('U2', '10 8.9'))
  const counts = thermalReport(zoneOf(b)).pads.map(p => p.spokes)
  assert.deepEqual(counts, [2, 2], 'one spoke to the fill and one to the other pad each')
  assert.deepEqual(spokeWarnings(b), [])
  // copper between the pads, on the line joining them
  const between = polysToRings(
    intersection(polysToRings(zoneOf(b).fill), [
      [
        [9.9, 7.9],
        [10.1, 7.9],
        [10.1, 8.0],
        [9.9, 8.0],
      ],
    ]),
  )
  near(Math.abs(area(between)), 0.02, 1e-4)
})

// a circle as KiCad writes a keepout circle: a polygon with a vertex every 10 degrees from angle 0
const circle = (cx, cy, r) => 'M ' + Array.from({ length: 36 }, (_, k) => `${cx + r * Math.cos((k * Math.PI) / 18)} ${cy + r * Math.sin((k * Math.PI) / 18)}`).join(' L ') + ' Z'

test('min width: a neck between two keepouts narrower than the min width is opened away, its pocket an island', () => {
  // two keepout circles 0.2 mm apart, as Base's tooling hole and M3 hole keepouts by FID1; below them a pocket closed by
  // keepouts on its other sides, which reaches the rest of the pour only through the neck
  const ko = d => keepout('F.Cu', d, { tracks: false, vias: false })
  const b = board(
    pour('GND', 'F.Cu', 'M2 2 H18 V18 H2 Z', { minWidth: 0.25 }),
    gndPad('U1', '4 4'),
    ko(circle(8.4, 9.5, 1.5)),
    ko(circle(13.35, 9.5, 3.25)),
    ko('M 2 9.5 H 8.4 V 13 H 2 Z'),
    ko('M 13.35 9.5 H 18 V 13 H 13.35 Z'),
    ko('M 2 11.5 H 18 V 13 H 2 Z'),
  )
  const z = zoneOf(b)
  const pocket = polysToRings(
    intersection(polysToRings(z.fill), [
      [
        [9.5, 10],
        [10.5, 10],
        [10.5, 11.4],
        [9.5, 11.4],
      ],
    ]),
  )
  assert.deepEqual(pocket, [], 'the pocket below the neck is removed')
  assert.ok(z.islandsRemoved?.count >= 1)
})

test('npth mask: every non-plated hole opens the mask by default, mask={false} opens none', () => {
  const b = board(
    h('footprint', { ref: 'H1', at: '5 5' }, h('pad', { num: '', size: 3.2, drill: 3.2, type: 'npth' })),
    h('footprint', { ref: 'H2', at: '12 5' }, h('pad', { num: '', size: 1, drill: 1.5, type: 'npth', maskExpansion: 0.1 })),
    h('footprint', { ref: 'H3', at: '15 15' }, h('pad', { num: '', size: 2, drill: 2, type: 'npth', mask: false })),
  )
  const [h1, h2, h3] = b.items.filter(i => i.kind === 'pad')
  assert.ok(h1.layers.includes('F.Mask') && h1.layers.includes('B.Mask'))
  near(Math.abs(area(h1.maskRings)), Math.PI * (1.6 + b.rules.maskExpansion) ** 2, 0.06)
  // a pad smaller than its hole: the hole grown by the expansion
  near(Math.abs(area(h2.maskRings)), Math.PI * 0.85 ** 2, 0.03)
  assert.equal(h3.maskRings, undefined)
  assert.deepEqual(
    h3.layers.filter(l => l.endsWith('.Mask')),
    [],
  )
})
