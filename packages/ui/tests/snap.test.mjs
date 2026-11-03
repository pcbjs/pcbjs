// The tools' snap service: grid points at the first subdivision and one finer with shift, cmd lifting snapping, rotated and mirrored
// grids, the ring's 15 degree stops from the grid angle and 5 with shift, `R` at 90, and magnets before the grid.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { angleAt, dragMods, fromGrid, KEY_TURN, levelOf, magnet, snapAngle, snapControl, snapFrom, snapPoint, stepOf, toGrid } from '../src/snap.ts'

const g = (o = {}) => ({ name: 'g', pitch: 2.54, minor: [], origin: [0, 0], angle: 0, mirror: false, ...o })
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9)

test('levels: the pitch, the first subdivision of minor, one finer with shift, past the list by halves', () => {
  const m = g({ minor: [2, 5], maxLevel: 3 })
  assert.deepEqual(
    [0, 1, 2, 3].map(l => +stepOf(m, l).toFixed(4)),
    [2.54, 1.27, 0.254, 0.127],
  )
  assert.equal(levelOf(m, false), 1)
  assert.equal(levelOf(m, true), 2)
  assert.equal(levelOf(g(), false), 0)
})

test('snapPoint: grid points, shift finer, cmd free to 1 µm, no grid free', () => {
  assert.deepEqual(snapPoint(g(), [3.1, 4.9], { fine: false, free: false }), [2.54, 5.08])
  assert.deepEqual(snapPoint(g(), [3.4, 4.9], { fine: true, free: false }), [3.81, 5.08])
  assert.deepEqual(snapPoint(g(), [3.12345, 4.9], { fine: false, free: true }), [3.123, 4.9])
  assert.deepEqual(snapPoint(null, [3.12345, 4.9], { fine: false, free: false }), [3.123, 4.9])
  assert.deepEqual(snapPoint(g({ origin: [1, 1] }), [3.1, 4.9], { fine: false, free: false }), [3.54, 6.08])
})

test('a rotated or mirrored grid: points along its axes, the frame of the compiler', () => {
  const r = g({ pitch: 1, angle: 90 })
  // one step along the grid's x at 90 degrees counter-clockwise on screen is up, y down
  assert.ok(near(fromGrid(r, [1, 0]), [0, -1]))
  assert.ok(near(toGrid(r, [0, -1]), [1, 0]))
  assert.deepEqual(snapPoint(r, [0.2, -1.1], { fine: false, free: false }), [0, -1])
  const m = g({ pitch: 1, mirror: true })
  assert.ok(near(fromGrid(m, [1, 0]), [-1, 0]))
})

test('rotation: the ring in 15 degree stops from the grid angle, 5 with shift, 0.1 free, R a quarter turn', () => {
  assert.equal(snapAngle(22, { fine: false, free: false }), 15)
  assert.equal(snapAngle(22, { fine: true, free: false }), 20)
  assert.equal(snapAngle(22.26, { fine: false, free: true }), 22.3)
  assert.equal(snapAngle(10, { fine: false, free: false }, 0, 7), 7, 'stops count from the grid angle')
  assert.equal(snapAngle(14, { fine: false, free: false }, 10, 0), 20, 'the result lands on a stop')
  assert.equal(KEY_TURN, 90)
  assert.equal(Math.round(angleAt([0, 0], [0, -1])), 90)
})

test('magnets: a pad centre or a point of the net within reach wins over the grid', () => {
  assert.deepEqual(
    magnet(
      [1.1, 1],
      [
        [1, 1],
        [5, 5],
      ],
      0.2,
    ),
    [1, 1],
  )
  assert.equal(magnet([2, 2], [[1, 1]], 0.2), null)
  assert.deepEqual(snapControl(g(), [1.05, 1], { fine: false, free: false }, [[1, 1]], 0.2), [1, 1])
  assert.deepEqual(snapControl(g(), [1.05, 1], { fine: false, free: true }, [[1, 1]], 0.2), [1.05, 1])
  assert.deepEqual(snapControl(g(), [3, 1], { fine: false, free: false }, [[1, 1]], 0.2), [2.54, 0])
})

test('a component on a grid snaps on the lattice through its own origin, as its dots show; shift free; no grid leaves it free', () => {
  const m = dragMods(false, false)
  // a part 0.2 mm off a 1 mm grid with a half step: a drag of 1.3 mm lands 1.5 mm on, still 0.2 off the grid's own points
  assert.ok(near(snapFrom(g({ pitch: 1, minor: [2] }), [10.2, 7.5], [11.5, 7.6], m), [11.7, 7.5]))
  assert.ok(near(snapPoint(g({ pitch: 1, minor: [2] }), [11.5, 7.6], m), [11.5, 7.5]), 'the grid alone snaps to its own points')
  // a rotated grid keeps its axes through the component's origin
  const r = snapFrom(g({ pitch: 1, angle: 90 }), [5, 5], [5.9, 3.2], m)
  assert.ok(near(r, [6, 3]), JSON.stringify(r))
  assert.deepEqual(snapFrom(g({ pitch: 1 }), [10.2, 7.5], [11.4567, 7.6], dragMods(true, false)), [11.457, 7.6])
  assert.deepEqual(snapFrom(null, [10.2, 7.5], [11.4567, 7.6], m), [11.457, 7.6])
})


test('alignment checks bounded subdivisions in rotated mirrored grids without moving the point', async () => {
  const { alignedLevel, fromGrid, levelOf, stepOf } = await import('../src/snap.ts')
  const g = { name: 'test', pitch: 1, minor: [], origin: [12, -7], angle: 35, mirror: true }
  assert.equal(alignedLevel(g, fromGrid(g, [1, 2])), 0)
  assert.equal(alignedLevel(g, fromGrid(g, [1.5, 2])), 1)
  assert.equal(alignedLevel(g, fromGrid(g, [1.25, 2.5])), 2)
  assert.equal(alignedLevel(g, fromGrid(g, [1.125, 2])), null)
  assert.equal(alignedLevel({ ...g, maxLevel: 3 }, fromGrid(g, [1.125, 2])), 3)
  assert.equal(alignedLevel({ ...g, maxLevel: 0 }, fromGrid(g, [1.5, 2])), null)
  assert.equal(alignedLevel({ ...g, minor: [2, 5] }, fromGrid(g, [1.1, 2])), 2)
  assert.equal(levelOf({ ...g, minor: [2], maxLevel: 0 }, true), 0)
  assert.equal(stepOf({ ...g, maxLevel: 1 }, 4), 0.5)
})
