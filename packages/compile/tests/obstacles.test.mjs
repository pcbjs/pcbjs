// The router's obstacle store and rasterisation, src/compile/obstacles.ts, and the crossover of a pair, src/compile/pair.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fill, fillAdd, ringSet, inside, ObstacleStore } from '../dist/obstacles.js'
import { circleRing } from '../dist/path.js'
import { crossVias, pairPaths } from '../dist/pair.js'
import { flatten } from '../dist/round.js'

const grid = { x0: 0, y0: 0, p: 0.075, nx: 961, ny: 587 }
const cellAt = (g, x, y) => Math.round((y - g.y0) / g.p) * g.nx + Math.round((x - g.x0) / g.p)

test('fill: a ring with vertices on a scanline fills that scanline, though the row index and the row y disagree in the last bit', () => {
  // 404 * 0.075 is 30.299999999999997 while 30.3 / 0.075 rounds up to 404.00000000000006: the row of the circle's centre
  // used to be skipped, a scanline of a via left out of the obstacles
  const s = ringSet([circleRing(43.4, 30.3, 0.3)])
  const a = new Uint16Array(grid.nx * grid.ny),
    b = new Uint8Array(grid.nx * grid.ny)
  fillAdd(grid, s, a, 1)
  fill(grid, s, b, 1)
  const c = cellAt(grid, 43.425, 30.3)
  assert.ok(inside(s, 43.425, 30.3))
  assert.equal(a[c], 1)
  assert.equal(b[c], 1)
  for (let i = 0; i < a.length; i++) {
    const x = (i % grid.nx) * grid.p,
      y = Math.floor(i / grid.nx) * grid.p
    assert.equal(a[i] > 0, inside(s, x, y), `cell (${x}, ${y})`)
  }
})

test('obstacle store: its counts follow the board as items come and go, equal to filling the items afresh', () => {
  const track = (id, net, pts) => ({ kind: 'track', id, layer: 'F.Cu', net, pts, width: 0.2 })
  const board = {
    items: [
      track(1, 'A', [
        [1, 1],
        [9, 1],
      ]),
      track(2, 'B', [
        [1, 3],
        [9, 3],
      ]),
    ],
    classes: undefined,
  }
  const rules = { clearance: 0.15, holeClearance: 0.25, minHoleToHole: 0.25 }
  const st = new ObstacleStore(board, rules, ['F.Cu', 'B.Cu'])
  const g = { x0: 0, y0: 0, p: 0.1, nx: 101, ny: 51 }
  const counts = () => st.trackCounts(g, 'F.Cu', 0.24, 0).slice()
  const fresh = () => {
    const a = new Uint16Array(g.nx * g.ny)
    for (const it of board.items) st.trackFill(g, it, st.rec(it), 'F.Cu', 0.24, 0, a, 1)
    return a
  }
  assert.deepEqual(counts(), fresh())
  board.items.push(
    track(3, 'C', [
      [2, 0.5],
      [2, 4.5],
    ]),
  )
  assert.deepEqual(counts(), fresh(), 'an item added')
  board.items[0] = {
    ...board.items[0],
    pts: [
      [1, 4],
      [9, 4],
    ],
  }
  assert.deepEqual(counts(), fresh(), 'an item replaced by another, the count of items the same')
  board.items.splice(0, 1)
  assert.deepEqual(counts(), fresh(), 'an item removed')
})

test('crossover: P and N swap sides at a via pair, with the two vias staggered on the incoming P side and no track crossing another on one layer', () => {
  const w = 0.2,
    g = 0.2,
    pitch = w + g,
    size = 0.6,
    clearance = 0.2
  const v = crossVias([0, 5], [0, 1], pitch, w, size, clearance, 1)
  assert.ok(Math.abs(v.P[1] - 5) < 1e-9 && v.N[1] > 5 + size, "N's via further along")
  assert.equal(Math.sign(v.P[0]), 1, 'on the left of travel down the board, +x')
  const geo = pairPaths(
    [
      [0, 0],
      [0, 5],
      [0, 10],
    ],
    w,
    g,
    { vias: [1], crosses: [0], viaSize: size, clearance, width: w },
  )
  const P = geo.runsP.map(r => flatten(r)),
    N = geo.runsN.map(r => flatten(r))
  // before: P on the left, +x; after: on the right
  assert.ok(P[0][0][0] > 0 && P[1][P[1].length - 1][0] < 0)
  assert.ok(N[0][0][0] < 0 && N[1][N[1].length - 1][0] > 0)
  const segDist = (p, a, b) => {
    const d = [b[0] - a[0], b[1] - a[1]],
      l2 = d[0] ** 2 + d[1] ** 2,
      t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2)) : 0
    return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1])
  }
  const gap = (a, b) => {
    let m = Infinity
    for (let i = 1; i < a.length; i++) for (const q of b) m = Math.min(m, segDist(q, a[i - 1], a[i]))
    for (let i = 1; i < b.length; i++) for (const q of a) m = Math.min(m, segDist(q, b[i - 1], b[i]))
    return m
  }
  for (const k of [0, 1]) assert.ok(gap(P[k], N[k]) >= w + Math.min(g, clearance) - 1e-6, `section ${k}: P and N keep the gap`)
  // each via keeps its clearance from the other net's track on both layers
  for (const k of [0, 1]) {
    assert.ok(Math.min(...N[k].slice(1).map((q, i) => segDist(geo.viasP[0], N[k][i], q))) >= size / 2 + w / 2 + clearance - 1e-6)
    assert.ok(Math.min(...P[k].slice(1).map((q, i) => segDist(geo.viasN[0], P[k][i], q))) >= size / 2 + w / 2 + clearance - 1e-6)
  }
})
