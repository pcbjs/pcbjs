// The parts planes of the exploded view: the board outline and an inner grid at the ground grid's step, cut out where the outline is.
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { gridSegs, outlineSegs } from '../src/scene/wire.ts'

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const count = segs => segs.length / 4

test('the outline is one segment per edge of every ring, cutouts included', () => {
  assert.equal(count(outlineSegs([rect(0, -20, 30, 0)])), 4)
  assert.equal(count(outlineSegs([rect(0, -20, 30, 0), rect(10, -15, 20, -5)])), 8)
})

test('the grid draws one line per step inside the outline, none on its edges', () => {
  const g = gridSegs([rect(0, -20, 30, 0)], 5)
  assert.equal(count(g), 5 + 3)
  assert.equal(count(gridSegs([rect(0, -20, 30, 0)], 1)), 29 + 19)
  assert.equal(count(gridSegs([rect(0.5, -20, 30, 0)], 10)), 2 + 1, 'lines on the step, not from the corner')
  for (let i = 0; i < g.length; i += 4) assert.ok([g[i], g[i + 2]].every(x => x >= 0 && x <= 30) && [g[i + 1], g[i + 3]].every(y => y >= -20 && y <= 0))
})

test('a cutout splits the lines across it, so the hole stays open', () => {
  const g = gridSegs([rect(0, -20, 30, 0), rect(12, -14, 18, -6)], 5)
  // x = 15 and y = -10 cross the hole and split in two
  assert.equal(count(g), 5 + 3 + 2)
  const at15 = []
  for (let i = 0; i < g.length; i += 4) if (g[i] === 15 && g[i + 2] === 15) at15.push([g[i + 1], g[i + 3]].sort((a, b) => a - b))
  assert.deepEqual(at15.sort((a, b) => a[0] - b[0]), [[-20, -14], [-6, 0]])
})

test('no rings or no step, no grid', () => {
  assert.deepEqual(gridSegs([], 1), [])
  assert.deepEqual(gridSegs([rect(0, 0, 10, 10)], 0), [])
})

test('four planes on a two-sided board: the parts and the silk of each side, the silk in its callout colour', () => {
  const view3d = readFileSync(new URL('../src/View3D.vue', import.meta.url), 'utf8')
  const loop = /for \(const side of \['F', 'B'\] as const\) \{([\s\S]*?)\n  \}/.exec(view3d)[1]
  const planes = [...loop.matchAll(/wirePlane\(`([^`]+)`/g)].map(m => m[1])
  assert.deepEqual(planes.sort(), ['${side}.SilkS', 'bodies:${side}'])
  assert.equal(planes.length * 2, 4)
  assert.match(loop, /wirePlane\(`\$\{side\}\.SilkS`, [^\n]*railOf\(`\$\{side\}\.SilkS`/)
})
