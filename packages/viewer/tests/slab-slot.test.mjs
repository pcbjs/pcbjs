// The board slab: a slot drill cuts a stadium of its width and length along its angle, a round drill a circle.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// the client imports its own modules without an extension, as Vite resolves them
registerHooks({ resolve(s, c, next) { try { return next(s, c) } catch (e) { if (s.startsWith('.') && !/\.[a-z]+$/.test(s)) return next(`${s}.ts`, c); throw e } } })
const { flatten, packDrills, runJob } = await import('../src/scene/geometry.ts')

const outline = flatten([[[0, 0], [10, 0], [10, 10], [0, 10]]])
/** The extent of the slab's vertices off its outline, in board mm, y down. */
function holeBox(drills) {
  const r = runJob({ kind: 'slab', key: 'k', outline, drills: packDrills(drills), depth: 1.6 })
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (let i = 0; i < r.position.length; i += 3) {
    const x = r.position[i], y = -r.position[i + 1]
    if ([0, 10].some(v => Math.abs(x - v) < 1e-6 || Math.abs(y - v) < 1e-6)) continue
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  return [x1 - x0, y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2]
}
const near = (a, b, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 0.01, `${msg}: ${a} not ${b}`))

test('slab: a slot is a stadium of its length along its axis and its width across', () => {
  near(holeBox([{ x: 5, y: 4, d: 0.8, len: 2.2, a: 0 }]), [2.2, 0.8, 5, 4], 'along x')
  near(holeBox([{ x: 5, y: 4, d: 0.6, len: 1.7, a: 90 }]), [0.6, 1.7, 5, 4], 'along y')
  near(holeBox([{ x: 5, y: 5, d: 1 }]), [1, 1, 5, 5], 'round')
})
