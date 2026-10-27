// Placement of STEP models in the 3D view, imported straight from the client TypeScript: KiCad's model transform, and the
// footprint placement checked against the compiler's own 2D placement of a footprint point.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, footprintMatrix, modelMatrix, stepMatrix } from '../src/scene/step-place.ts'

const NONE = { offset: [0, 0, 0], rotate: [0, 0, 0], scale: [1, 1, 1] }
const near = (a, b, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${msg ?? ''} got ${a}, want ${b}`))

// compile/geom placement(): translate · rotate counter-clockwise on the y-down screen · mirror x when on the back
function boardPoint(at, rot, back, [lx, ly]) {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  const x = back ? -lx : lx
  return [at[0] + c * x + s * ly, at[1] - s * x + c * ly]
}

test('the model frame maps to the footprint frame: x along x, y along -y, z up from the face', () => {
  for (const rot of [0, 30, 90, 180, 270, 333])
    for (const side of ['F', 'B'])
      for (const p of [[1, 0], [0, 1], [2.5, -1.25], [-3, 4]]) {
        const fp = { at: [10, 5], rot, side }
        const [bx, by] = boardPoint(fp.at, rot, side === 'B', p)
        // a footprint point (x, y) is the model point (x, -y)
        const s = apply(footprintMatrix(fp, 1.6), [p[0], -p[1], 0])
        near(s, [bx, -by, 1.6], `${side} ${rot}° ${p}`)
      }
})

test('a front part stands up from the top face, a back part hangs below the bottom face', () => {
  near(apply(footprintMatrix({ at: [0, 0], rot: 45, side: 'F' }, 1.6), [0, 0, 2]), [0, 0, 3.6])
  near(apply(footprintMatrix({ at: [0, 0], rot: 45, side: 'B' }, 0), [0, 0, 2]), [0, 0, -2])
})

test('the model transform is scale, then rotate about x, y and z by the negated angles, then offset, as KiCad', () => {
  near(apply(modelMatrix(NONE), [1, 2, 3]), [1, 2, 3])
  near(apply(modelMatrix({ ...NONE, offset: [1, 2, 3] }), [0, 0, 0]), [1, 2, 3])
  // KiCad turns the model by -90 degrees about z for rotate z 90: its x axis to -y
  near(apply(modelMatrix({ ...NONE, rotate: [0, 0, 90] }), [1, 0, 0]), [0, -1, 0])
  near(apply(modelMatrix({ ...NONE, rotate: [90, 0, 0] }), [0, 1, 0]), [0, 0, -1])
  near(apply(modelMatrix({ ...NONE, rotate: [0, 90, 0] }), [1, 0, 0]), [0, 0, 1])
  // x first, then z: z goes to y under x, then to x under z
  near(apply(modelMatrix({ ...NONE, rotate: [90, 0, 90] }), [0, 0, 1]), [1, 0, 0])
  // scale before the rotation, the offset after it
  near(apply(modelMatrix({ offset: [0, 0, 1], rotate: [0, 0, 90], scale: [2, 1, 1] }), [1, 0, 0]), [0, -2, 1])
})

test('the whole placement is the footprint placement times the model transform', () => {
  const t = { offset: [0.5, -0.25, 0.1], rotate: [0, 0, 180], scale: [1, 1, 1] }
  const fp = { at: [12, 3.4], rot: 180, side: 'F' }
  // turned twice by 180 degrees, the model x axis is the board x axis again
  const o = apply(stepMatrix(fp, t, 1.6), [0, 0, 0]), x = apply(stepMatrix(fp, t, 1.6), [1, 0, 0])
  near([x[0] - o[0], x[1] - o[1], x[2] - o[2]], [1, 0, 0])
  // the offset turns with the footprint: -0.5 in x, +0.25 in scene y
  near(o, [11.5, -3.4 + 0.25, 1.7])
})
