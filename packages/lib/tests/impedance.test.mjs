// Reference values. "FD" is a two-dimensional finite-difference quasi-static solve of the same cross-section, uncoated,
// 5 um grid, done while writing these tests; the calculators quoted in the comments are the usual public ones
// (Saturn PCB Toolkit, KiCad's calculator, the JLCPCB impedance calculator). Tolerance 10 percent unless noted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impedanceOf, traceWidth, pairGeometry, traceModel, twoLayer, sixLayer, JLCPCB_4L_7628 } from '../dist/index.js'

const within = (actual, expected, frac, what) => assert.ok(Math.abs(actual - expected) <= frac * expected, `${what}: ${actual} is not within ${frac * 100}% of ${expected}`)
const J = JLCPCB_4L_7628

test('impedance: the model reads planes, height, er and copper from the stackup', () => {
  const two = traceModel(twoLayer(), 'F.Cu')
  assert.equal(two.kind, 'microstrip')
  assert.deepEqual(two.planes, ['B.Cu'])
  assert.equal(two.h, 1.51)
  assert.equal(two.er, 4.5)
  assert.equal(two.t, 0.035)
  const in1 = traceModel(J, 'in1.cu')
  assert.equal(in1.kind, 'stripline')
  assert.deepEqual(in1.planes, ['F.Cu', 'In2.Cu'])
  assert.equal(in1.h, 0.2104)
  assert.equal(in1.h2, 1.065)
  // thickness weighted er of the 7628 prepreg above (4.4) and the core below (4.6)
  assert.ok(Math.abs(in1.er - (4.4 * 0.2104 + 4.6 * 1.065) / (0.2104 + 1.065)) < 1e-12)
  assert.equal(traceModel(J, 'bottom').h, 0.2104)
})

test('impedance: 50 ohm microstrip on a 1.6 mm two layer FR4 board is about 3 mm wide', () => {
  // twoLayer(): 1.51 mm core after copper and mask, er 4.5, 35 um copper. Saturn and KiCad give about 2.8 mm for that core.
  const w = traceWidth(twoLayer(), 'F.Cu', 50)
  within(w, 2.95, 0.1, '50 ohm on twoLayer()')
  within(w, 2.8, 0.02, '50 ohm on twoLayer(), against Hammerstad and Jensen in KiCad')
  // a full 1.6 mm dielectric, the textbook case: 2.9 to 3.0 mm
  const s = {
    layers: [
      { type: 'copper', name: 'F.Cu', thickness: 0.035 },
      { type: 'core', thickness: 1.6, er: 4.5 },
      { type: 'copper', name: 'B.Cu', thickness: 0.035 },
    ],
  }
  within(traceWidth(s, 'F.Cu', 50), 2.95, 0.03, '50 ohm over 1.6 mm')
})

test('impedance: JLCPCB four layer, F.Cu single ended', () => {
  // FD: 0.372 mm is 50.5 ohm and 0.2 mm is 68.2 ohm. Saturn gives 0.37 mm for 50 ohm uncoated; JLCPCB's calculator, which
  // includes the solder mask, gives about 0.34 mm. The model is uncoated, so it comes out a little wider.
  const w = traceWidth(J, 'F.Cu', 50)
  within(w, 0.36, 0.1, '50 ohm on F.Cu')
  within(impedanceOf(J, 'F.Cu', 0.372), 50.5, 0.02, 'FD at 0.372 mm')
  within(impedanceOf(J, 'F.Cu', 0.2), 68.2, 0.02, 'FD at 0.2 mm')
  // a round trip through the solver
  within(impedanceOf(J, 'F.Cu', w), 50, 1e-6, 'round trip')
})

test('impedance: JLCPCB four layer, F.Cu differential', () => {
  // FD: 0.2 / 0.15 mm is 102.7 ohm and 0.15 / 0.15 mm is 113.6 ohm uncoated. JLCPCB's calculator puts 90 ohm near 0.2 mm
  // with 0.15 to 0.2 mm gap and 100 ohm near 0.15 / 0.15 mm, with the mask on, which lowers a tight pair by 8 to 12 ohm.
  within(impedanceOf(J, 'F.Cu', 0.2, 0.15), 102.7, 0.03, 'FD 0.2 / 0.15')
  within(impedanceOf(J, 'F.Cu', 0.15, 0.15), 113.6, 0.03, 'FD 0.15 / 0.15')
  const p90 = pairGeometry(J, 'F.Cu', 90, { gap: 0.15 })
  assert.equal(p90.gap, 0.15)
  within(impedanceOf(J, 'F.Cu', p90.width, 0.15), 90, 1e-6, '90 ohm round trip')
  within(p90.width, 0.27, 0.1, '90 ohm width at 0.15 mm gap')
  const p100 = pairGeometry(J, 'F.Cu', 100, { gap: 0.15 })
  within(p100.width, 0.21, 0.1, '100 ohm width at 0.15 mm gap')
  // the gap for a given width rises with the target
  const g = pairGeometry(J, 'F.Cu', 100, { width: 0.2 })
  assert.equal(g.width, 0.2)
  within(impedanceOf(J, 'F.Cu', 0.2, g.gap), 100, 1e-6, 'gap round trip')
  assert.ok(g.gap < 0.15)
  // neither given: the gap equals the width
  const free = pairGeometry(J, 'F.Cu', 100)
  assert.equal(free.gap, free.width)
  within(impedanceOf(J, 'F.Cu', free.width, free.gap), 100, 1e-6, 'free round trip')
  // both given come back as they are
  assert.deepEqual(pairGeometry(J, 'F.Cu', 100, { width: 0.2, gap: 0.2 }), { width: 0.2, gap: 0.2 })
})

test('impedance: stripline on an inner layer', () => {
  // FD on JLCPCB In1.Cu, 0.21 mm to F.Cu and 1.07 mm to In2.Cu: 0.1 mm 72.0, 0.2 mm 56.0, 0.3 mm 46.6 ohm. The offset model,
  // the parallel combination KiCad's calculator also uses, reads 5 to 8 percent high on a layer this far off centre.
  within(impedanceOf(J, 'In1.Cu', 0.1), 72.0, 0.1, 'In1 0.1 mm')
  within(impedanceOf(J, 'In1.Cu', 0.2), 56.0, 0.1, 'In1 0.2 mm')
  within(impedanceOf(J, 'In1.Cu', 0.3), 46.6, 0.1, 'In1 0.3 mm')
  // FD on a near-centred inner layer, 0.2 and 0.42 mm to the planes, 17.5 um copper, er 4.5: 0.15 mm is 57.1 ohm
  const six = {
    layers: [
      { type: 'copper', name: 'F.Cu', thickness: 0.035 },
      { type: 'core', thickness: 0.2, er: 4.5 },
      { type: 'copper', name: 'In1.Cu', thickness: 0.0175 },
      { type: 'core', thickness: 0.42, er: 4.5 },
      { type: 'copper', name: 'In2.Cu', thickness: 0.0175 },
      { type: 'core', thickness: 0.2, er: 4.5 },
      { type: 'copper', name: 'B.Cu', thickness: 0.035 },
    ],
  }
  within(impedanceOf(six, 'In1.Cu', 0.15), 57.1, 0.04, 'centred stripline')
  // FD for an In1.Cu pair, 0.15 / 0.15 mm: 92.6 ohm
  within(impedanceOf(J, 'In1.Cu', 0.15, 0.15), 92.6, 0.1, 'In1 pair')
  within(impedanceOf(J, 'In1.Cu', traceWidth(J, 'In1.Cu', 50)), 50, 1e-6, 'stripline round trip')
  assert.equal(traceModel(sixLayer(), 'In2.Cu').kind, 'stripline')
})

test('impedance: clear errors', () => {
  assert.throws(() => impedanceOf(J, 'In3.Cu', 0.2), /"In3.Cu" is not a copper layer of the stackup \(it has F.Cu, In1.Cu, In2.Cu, B.Cu\)/)
  const lone = {
    layers: [
      { type: 'copper', name: 'F.Cu', thickness: 0.035 },
      { type: 'core', thickness: 1.5 },
    ],
  }
  assert.throws(() => impedanceOf(lone, 'F.Cu', 0.2), /no reference plane for F.Cu/)
  assert.throws(() => impedanceOf(J, 'F.Cu', 0), /width must be a positive number/)
  assert.throws(() => traceWidth(J, 'F.Cu', 1000), /1000 ohms is out of reach for a trace on F.Cu/)
  assert.throws(() => traceWidth(J, 'F.Cu', -1), /target must be a positive number/)
})
