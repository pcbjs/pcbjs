// Fitting a model to its footprint: a through-hole part drawn turned, off centre and in inches, a surface-mount part drawn
// upside down, the unit guess and the courtyard check, each against an answer known by construction.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { alignModel, guessUnit, placementIssue, footprintRect } from '../dist/index.js'
import { apply, modelMatrix } from '../dist/place.js'

/** A closed box as a mesh: 12 triangles, outward. */
function box([x0, y0, z0], [x1, y1, z1]) {
  const c = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ]
  const q = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ]
  return { pts: c, tris: q.flatMap(([a, b, cc, d]) => [a, b, cc, a, cc, d]) }
}
/** Boxes as one model, each point moved by f. */
function model(boxes, f = p => p) {
  const positions = [],
    indices = []
  for (const b of boxes) {
    const base = positions.length / 3
    for (const p of b.pts) positions.push(...f(p))
    indices.push(...b.tris.map(i => i + base))
  }
  return { meshes: [{ positions: new Float32Array(positions), normals: new Float32Array(positions.length), indices: new Uint32Array(indices), color: [0.5, 0.5, 0.5] }] }
}

// a connector: a 12 x 8 x 6 mm body on the board, its centre 3 mm left of the pins, and a 2 x 3 grid of pins at a 2.54 mm pitch
// hanging 3 mm under it; footprint frame with y down
const PINS = [
  [0, 0],
  [2.54, 0],
  [5.08, 0],
  [0, 2.54],
  [2.54, 2.54],
  [5.08, 2.54],
]
const PADS = PINS.map(([x, y]) => ({ x, y, w: 1.7, h: 1.7, drill: 1 }))
const connector = () => [box([-6.46, -5.27, 0], [5.54, 2.73, 6]), ...PINS.map(([x, y]) => box([x - 0.32, -y - 0.32, -3], [x + 0.32, -y + 0.32, 0.5]))]

/** Where the fitted transform puts each pin tip, in the footprint frame. */
const tips = (r, f, pins) =>
  pins.map(([x, y]) => {
    const p = apply(modelMatrix(r.transform), f([x, -y, -3]))
    return [p[0], -p[1]]
  })

test('a through-hole part drawn turned 90 degrees, 4 mm off and in inches lands its pins on the pads and its body on the board', () => {
  // the file: the connector turned 90 degrees about z, moved, and drawn in inches
  const f = ([x, y, z]) => [(-y + 4) / 25.4, (x - 1) / 25.4, (z + 2) / 25.4]
  const r = alignModel(model(connector(), f), { pads: PADS, courtyard: { x0: -7, y0: -3.2, x1: 6, y1: 5.8 } })
  assert.equal(r.unit.name, 'inches')
  assert.deepEqual(r.transform.scale, [25.4, 25.4, 25.4])
  assert.equal(r.matched, 6)
  assert.equal(r.pins, 6)
  assert.ok(r.confidence > 0.9, `confidence ${r.confidence}`)
  for (const [i, t] of tips(r, f, PINS).entries()) assert.ok(Math.hypot(t[0] - PADS[i].x, t[1] - PADS[i].y) < 0.05, `pin ${i} at ${t}`)
  // the body's underside sits on the board: z 0 of the original is z 0 placed
  const under = apply(modelMatrix(r.transform), f([0, 0, 0]))
  assert.ok(Math.abs(under[2]) < 0.05, `underside at ${under[2]}`)
})

test('a surface-mount part drawn upside down is turned over and sits on its leads', () => {
  // a SOT-23-like part: a 3 x 1.4 x 1 mm body 0.1 mm up and three 0.4 x 0.6 mm feet under it
  const feet = [
    [-0.95, 1.1],
    [0.95, 1.1],
    [0, -1.1],
  ]
  const pads = feet.map(([x, y]) => ({ x, y, w: 0.6, h: 0.9 }))
  const boxes = [box([-1.5, -0.7, 0.1], [1.5, 0.7, 1.1]), ...feet.map(([x, y]) => box([x - 0.2, -y - 0.3, 0], [x + 0.2, -y + 0.3, 0.15]))]
  const f = ([x, y, z]) => [x + 0.5, -y, -z]
  const r = alignModel(model(boxes, f), { pads, courtyard: { x0: -1.7, y0: -1.7, x1: 1.7, y1: 1.7 } })
  assert.equal(r.unit.name, 'mm')
  assert.equal(r.matched, 3)
  assert.match(r.up, /^-z$/)
  for (const [i, [x, y]] of feet.entries()) {
    const p = apply(modelMatrix(r.transform), f([x, -y, 0]))
    assert.ok(Math.hypot(p[0] - x, -p[1] - y) < 0.05 && Math.abs(p[2]) < 0.02, `foot ${i} at ${p}`)
  }
})

test('a model already in place keeps the identity, and a file without pins is centred on the courtyard with a low confidence', () => {
  const r = alignModel(model(connector()), { pads: PADS, courtyard: { x0: -7, y0: -3.2, x1: 6, y1: 5.8 } })
  assert.deepEqual(r.transform, { offset: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] })
  const plain = alignModel(model([box([10, 10, 0], [14, 12, 1])]), {
    pads: [
      { x: -1, y: 0, w: 1, h: 1 },
      { x: 1, y: 0, w: 1, h: 1 },
    ],
    courtyard: { x0: -2.2, y0: -1.2, x1: 2.2, y1: 1.2 },
  })
  assert.deepEqual(plain.transform.offset, [-12, -11, 0])
  assert.ok(plain.confidence <= 0.4, `confidence ${plain.confidence}`)
})

test('the unit guess compares the model with the footprint, else goes by size alone', () => {
  assert.equal(guessUnit(10, 12).name, 'mm')
  assert.equal(guessUnit(0.4, 10).name, 'inches')
  assert.equal(guessUnit(0.012, 11).name, 'metres')
  assert.equal(guessUnit(254, 10).name, 'mm read as inches')
  assert.equal(guessUnit(5).name, 'mm')
  assert.equal(guessUnit(0.005).name, 'metres')
})

test('the courtyard check flags a box more than 1 mm past a side and a model in other units', () => {
  const b = { min: [-3, -1, 0], max: [3, 1, 1] }
  const id = { offset: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] }
  const cy = { x0: -3.5, y0: -1.2, x1: 3.5, y1: 1.2 }
  assert.equal(placementIssue(b, id, cy), null)
  assert.deepEqual(footprintRect(b, { ...id, offset: [0, 2, 0] }), { x0: -3, y0: -3, x1: 3, y1: -1 })
  assert.match(placementIssue(b, { ...id, offset: [0, 2, 0] }, cy), /reaches 1\.8 mm past the courtyard at -y/)
  assert.equal(placementIssue(b, { ...id, offset: [0.4, 0, 0] }, cy), null, 'within 1 mm')
  assert.match(placementIssue(b, { ...id, rotate: [0, 0, 90] }, cy), /past the courtyard at -y \+y/)
  assert.match(placementIssue(b, { ...id, scale: [0.04, 0.04, 0.04] }, cy), /wrong units/)
})

test("KiCad's own JK0654219NL model fits KiCad's own land pattern with no transform", async () => {
  // the pads of Connector_RJ.pretty/RJ45_Pulse_JK0654219NL_Horizontal.kicad_mod: centre, size and drill, origin at pin 1
  const P = [
    [15.24, -1.27, 3.2, 3.2],
    [15.24, 11.43, 3.2, 3.2],
    ...[0, 2.032, 4.064, 6.096, 8.128, 10.16].map(y => [0, y, 0.89, 1.524]),
    ...[-1.016, 1.016, 3.048, 7.112, 9.144, 11.176].map(y => [-2.54, y, 0.89, 1.524]),
    ...[-1.016, 1.524, 8.636, 11.176].map(y => [-5.08, y, 1.025, 1.8]),
    [18.415, -2.9845, 1.57, 2.63],
    [18.415, 13.1445, 1.57, 2.61],
  ]
  const pads = P.map(([x, y, drill, w]) => ({ x, y, w, h: w, drill }))
  const { modelToMesh } = await import('../dist/index.js')
  const file = new URL('../../../examples/eth-phy/models/RJ45_Pulse_JK0654219NL_Horizontal.step', import.meta.url).pathname
  const r = alignModel(await modelToMesh(file), { pads })
  assert.deepEqual(r.transform.rotate, [0, 0, 0])
  assert.ok(Math.hypot(r.transform.offset[0], r.transform.offset[1], r.transform.offset[2]) < 0.05, `offset ${r.transform.offset}`)
  assert.equal(r.matched, r.pins)
  assert.ok(r.confidence >= 0.8, `confidence ${r.confidence}`)
})

// The review reproductions, on the files the example boards carry: each fit against what KiCad or the maker meant.
const EX = new URL('../../../examples/', import.meta.url).pathname
const pads = list => list.map(([x, y, w, h, drill]) => ({ x, y, w, h, ...(drill ? { drill } : {}) }))
const moved = (m, [dx, dy, dz]) => ({
  meshes: m.meshes.map(me => {
    const p = new Float32Array(me.positions)
    for (let i = 0; i < p.length; i += 3) {
      p[i] += dx
      p[i + 1] += dy
      p[i + 2] += dz
    }
    return { ...me, positions: p }
  }),
})
const mesh = async file => {
  const { modelToMesh } = await import('../dist/index.js')
  return modelToMesh(EX + file)
}

// an LCSC model under EasyEDA's terms, not in the repository: scripts/check-examples.mjs --fetch downloads it
const ws2812 = EX + 'sensor-hat/models/WS2812B-2020.step'
test(
  'the WS2812B-2020 stands upright: as drawn it is kept, moved it is moved back, and lying on its side is flagged',
  { skip: !existsSync(ws2812) && 'WS2812B-2020.step not fetched' },
  async () => {
    const m = await mesh('sensor-hat/models/WS2812B-2020.step')
    const target = {
      pads: pads([
        [-0.915, -0.55, 0.7, 0.7],
        [-0.915, 0.55, 0.7, 0.7],
        [0.915, 0.55, 0.7, 0.7],
        [0.915, -0.55, 0.7, 0.7],
      ]),
      courtyard: { x0: -1.52, y0: -1.25, x1: 1.52, y1: 1.25 },
      height: 0.84,
    }
    const r = alignModel(m, target)
    assert.deepEqual(r.transform, { offset: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] })
    assert.equal(r.kept, 'file')
    // off the origin the search runs, and still stands it on its own base
    const s = alignModel(moved(m, [3, 1, 0]), target)
    assert.equal(s.up, '+z')
    assert.deepEqual(s.transform.rotate, [0, 0, 0])
    assert.deepEqual(s.transform.offset, [-3, -1, 0])
    // the transform align once gave, on its side: 2 mm tall where the footprint says 0.84
    const { bounds } = await import('../dist/mesh.js')
    const side = { offset: [0, 0.69, 1], rotate: [0, 90, -90], scale: [1, 1, 1] }
    assert.match(placementIssue(bounds(m), side, target.courtyard, 1, { height: 0.84 }), /2\.0 mm tall where the footprint declares 0\.8 mm, and .* lying on its side\?/)
    assert.equal(placementIssue(bounds(m), r.transform, target.courtyard, 1, { height: 0.84 }), null)
    assert.match(placementIssue(bounds(m), { ...r.transform, offset: [0, 0, -0.5] }, target.courtyard, 1, { height: 0.84 }), /reaches 0\.5 mm into the board: sunk/)
  },
)

test("a verbatim KiCad land pattern keeps KiCad's model at zero: the DM3AT socket and the TO-252", async () => {
  const sd = alignModel(await mesh('sensor-hat/models/microSD_HC_Hirose_DM3AT-SF-PEJM5.step'), {
    pads: pads([
      [2.775, -7.725, 0.7, 1.2],
      [1.675, -7.725, 0.7, 1.2],
      [0.575, -7.725, 0.7, 1.2],
      [-0.525, -7.725, 0.7, 1.2],
      [-1.625, -7.725, 0.7, 1.2],
      [-2.725, -7.725, 0.7, 1.2],
      [-3.825, -7.725, 0.7, 1.2],
      [-4.925, -7.725, 0.7, 1.2],
      [-5.875, -7.725, 0.7, 1.2],
      [-6.825, 2.775, 1, 0.8],
      [-6.825, -3.425, 1, 1.2],
      [-6.825, 6.925, 1, 2.8],
      [4.325, -7.725, 1, 1.2],
      [6.675, 7.375, 1.3, 1.9],
    ]),
    courtyard: { x0: -7.82, y0: -8.82, x1: 7.88, y1: 8.88 },
    height: 1.6,
  })
  assert.deepEqual(sd.transform.offset, [0, 0, 0])
  const dpak = alignModel(await mesh('motor-stack/lib/models/TO-252-2.step'), {
    pads: pads([
      [-5.04, -2.28, 2.2, 1.2],
      [1.26, 0, 6.4, 5.8],
      [-5.04, 2.28, 2.2, 1.2],
    ]),
    courtyard: { x0: -6.39, y0: -3.5, x1: 4.71, y1: 3.5 },
    height: 2.4,
  })
  assert.deepEqual(dpak.transform.offset, [0, 0, 0])
})

test('a 2 x 20 socket whose rows run the other way lands on the pitch, 2.54 and not 2.48', async () => {
  const grid = []
  for (let i = 0; i < 20; i++) for (const x of [0, 2.54]) grid.push([x, i * 2.54, 1.7, 1.7, 1])
  const r = alignModel(await mesh('sensor-hat/models/PinSocket_2x20_P2.54mm_Vertical.step'), {
    pads: pads(grid),
    courtyard: { x0: -1.77, y0: -1.77, x1: 4.31, y1: 50.03 },
    height: 8.5,
  })
  assert.deepEqual(r.transform.offset, [2.54, 0, 0])
  assert.equal(r.matched, 40)
})

test('a TO-220 standing on its lead shoulders keeps its standoff, as drawn and when moved in x and y', async () => {
  const m = await mesh('psu/models/TO-220-2_Vertical.step')
  const target = {
    pads: pads([
      [0, 0, 2, 2, 1.1],
      [5.08, 0, 2, 2, 1.1],
    ]),
    courtyard: { x0: -2.71, y0: -3.4, x1: 7.79, y1: 1.5 },
    height: 15,
  }
  assert.deepEqual(alignModel(m, target).transform.offset, [0, 0, 0])
  assert.deepEqual(alignModel(moved(m, [2, 1, 0]), target).transform.offset, [-2, -1, 0])
})

test('the transform a part has stays when it fits, as the mirrored one of a .kicad_mod model line', () => {
  // the connector of the first test drawn mirrored in x about x = 2.54, with KiCad's line offset [5.08, 0, 0] scale [-1, 1, 1]
  const f = ([x, y, z]) => [5.08 - x, y, z]
  const keep = { offset: [5.08, 0, 0], rotate: [0, 0, 0], scale: [-1, 1, 1] }
  const r = alignModel(model(connector(), f), { pads: PADS, courtyard: { x0: -7, y0: -3.2, x1: 6, y1: 5.8 } }, { keep: [keep] })
  assert.equal(r.kept, 'current')
  assert.deepEqual(r.transform, keep)
})

test('a fit 0.06 mm off zero snaps to zero', () => {
  const r = alignModel(
    model(connector(), ([x, y, z]) => [x + 0.06, y - 0.05, z + 0.5]),
    { pads: PADS, courtyard: { x0: -7, y0: -3.2, x1: 6, y1: 5.8 } },
  )
  assert.deepEqual(r.transform.offset.slice(0, 2), [0, 0])
})
