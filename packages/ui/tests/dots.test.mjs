// The assist dot field on a fixture: a line for H and V, four directions for L, a matrix for X and `at`, clipped to the outline,
// clustered round the anchor without one, a dot on another net's pad faint with its reason, the typed point and the pick text.
import { test } from 'node:test'
import { shaped } from './shaped.mjs'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { candidates, dotField, dotPaths, light, litGrid, nearest, originDots, pickText, typedPoint, dotGrid } = await import('../src/dots.ts')

const rect = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
]
/** A 10 by 6 mm board with a pad of net GND at 6 3 and one of VCC, the context's net, at 2 3. */
const board = (outline = true) =>
  shaped({
    name: 'Fx',
    outline: outline ? [rect(0, 0, 10, 6)] : [],
    grids: [{ name: 'g', pitch: 2, minor: [], origin: [0, 0], angle: 0, mirror: false, frame: null, used: [] }],
    items: [
      { id: 1, kind: 'pad', ref: 'R2', net: 'GND', layers: ['F.Cu'], rings: [rect(5.6, 2.6, 0.8, 0.8)] },
      { id: 2, kind: 'pad', ref: 'J1', net: 'VCC', layers: ['F.Cu'], rings: [rect(1.6, 2.6, 0.8, 0.8)] },
    ],
    keepouts: [],
  })
const ctx = (command, extra = {}) => ({
  board: 'Fx',
  command,
  relative: /^[lhv]$/.test(command),
  ref: 'route:1',
  start: [2, 3],
  pad: 'J1/1',
  layer: 'F.Cu',
  net: 'VCC',
  side: 'F',
  grid: null,
  width: 0.2,
  typed: [],
  open: false,
  ...extra,
})
const sorted = pts => pts.map(p => p.join(' ')).sort()

test('dots: H is the row through the anchor on whole millimetres, V the column', () => {
  assert.deepEqual(sorted(candidates(ctx('H'), board())), sorted([0, 1, 3, 4, 5, 6, 7, 8, 9, 10].map(x => [x, 3])))
  assert.deepEqual(sorted(candidates(ctx('V'), board())), sorted([0, 1, 2, 4, 5, 6].map(y => [2, y])))
})

test('dots: a relative h counts pitches from the anchor, on a grid its pitch', () => {
  const pts = candidates(ctx('h', { start: [2.5, 3], grid: 'g' }), board())
  assert.deepEqual(sorted(pts), sorted([0.5, 4.5, 6.5, 8.5].map(x => [x, 3])))
})

test('dots: l is four directions through the anchor', () => {
  const pts = candidates(ctx('l'), board())
  const dirs = new Set(pts.map(([x, y]) => (Math.atan2(y - 3, x - 2) * 180) / Math.PI).map(a => Math.round(((a % 180) + 180) % 180)))
  assert.deepEqual(
    [...dirs].sort((a, b) => a - b),
    [0, 45, 90, 135],
  )
  assert.ok(pts.some(p => p[0] === 5 && p[1] === 6))
})

test('dots: X and at are the grid as a matrix inside the outline', () => {
  const x = candidates(ctx('X', { grid: 'g' }), board())
  assert.equal(x.length, 6 * 4)
  assert.ok(x.every(([a, b]) => a % 2 === 0 && b % 2 === 0))
  assert.equal(candidates(ctx('at', { start: null, grid: 'g' }), board()).length, 24)
})

test('dots: shift shows every grid dot for any command', () => {
  assert.equal(candidates(ctx('H', { grid: 'g' }), board(), true).length, 24)
})

test('dots: without an outline they cluster round the anchor', () => {
  const pts = candidates(ctx('X'), board(false))
  const far = Math.max(...pts.map(([x, y]) => Math.max(Math.abs(x - 2), Math.abs(y - 3))))
  assert.equal(far, 12)
})

test('dots: a dot on another net is unavailable with its reason, one on its own net is not; outside the outline none', () => {
  const dots = dotField(ctx('H'), board())
  assert.deepEqual(
    dots.find(d => d.at[0] === 6),
    { at: [6, 3], ok: false, why: 'on pad R2 of GND' },
  )
  assert.ok(dots.filter(d => d.at[0] !== 6).every(d => d.ok))
  assert.ok(dots.every(d => d.at[0] > 0 && d.at[0] < 10))
})

test('dots: the falloff lights near the anchor and the pointer, the nearest dot within reach is picked', () => {
  assert.equal(light([2, 3], [2, 3], null, 4), 1)
  assert.equal(light([9, 3], [2, 3], [9, 3], 4), 1)
  assert.ok(light([20, 20], [2, 3], [9, 3], 4) < 0.2)
  const dots = dotField(ctx('V'), board())
  assert.deepEqual(nearest(dots, [2.2, 4.9], 0.5).at, [2, 5])
  assert.equal(nearest(dots, [4, 4], 0.5), null)
})

test('dots: the typed argument names a point, and the pick text is what the session writes', () => {
  assert.deepEqual(typedPoint(ctx('H', { typed: [7] })), [7, 3])
  assert.deepEqual(typedPoint(ctx('v', { typed: [-1] })), [2, 2])
  assert.equal(typedPoint(ctx('L', { typed: [5] })), null)
  assert.equal(pickText(ctx('H'), [7, 5]), '.H(7)')
  assert.equal(pickText(ctx('l'), [5, 6]), '.l(3, 3)')
  assert.equal(pickText(ctx('X'), [4, 4]), ".X('4 4')")
})

test('dots: one path per brightness step, and the lit grid round the pointer is unbounded', () => {
  const paths = dotPaths(
    [
      { at: [0, 0], level: 0.05 },
      { at: [1, 0], level: 0.99 },
    ],
    0.1,
    4,
  )
  assert.equal(paths.length, 4)
  assert.ok(paths[0].startsWith('M-0.1 0a') && paths[3].startsWith('M0.9 0a'))
  const lit = litGrid(dotGrid(ctx('X', { grid: 'g' }), board()), [100, 100])
  assert.ok(lit.length > 20 && lit.every(p => p.level > 0 && Math.hypot(p.at[0] - 100, p.at[1] - 100) < 12))
})

test('a component grid: dots of its snap step through the component origin, the pitch when too dense, none past that', () => {
  const g = { name: 'f', pitch: 1, minor: [2], origin: [0, 0], angle: 0, mirror: false }
  const dots = originDots(g, [10.2, 7.5], [8, 6, 12, 9], 0.05)
  assert.ok(
    dots.some(d => d.at[0] === 10.2 && d.at[1] === 7.5),
    'a dot on the origin',
  )
  assert.ok(
    dots.some(d => d.at[0] === 10.7 && d.at[1] === 8),
    'half a pitch on',
  )
  assert.ok(
    dots.every(d => Math.abs(((d.at[0] - 10.2) / 0.5) % 1) < 1e-6 || Math.abs(Math.abs(((d.at[0] - 10.2) / 0.5) % 1) - 1) < 1e-6),
    'every dot on the lattice through the origin',
  )
  assert.equal(Math.max(...dots.map(d => d.level)), 1, 'brightest at the origin')
  const sparse = originDots(g, [10.2, 7.5], [8, 6, 12, 9], 0.1)
  assert.ok(sparse.length && sparse.every(d => Math.abs((d.at[0] - 10.2) % 1) < 1e-6 || Math.abs(Math.abs((d.at[0] - 10.2) % 1) - 1) < 1e-6), 'a half step under 6 px: the pitch')
  assert.deepEqual(originDots(g, [10.2, 7.5], [8, 6, 12, 9], 0.5), [], 'a pitch under 6 px: none')
})
