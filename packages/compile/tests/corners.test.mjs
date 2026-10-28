// Rounded corners of pairs and the clean joins of fans and flares: pairPaths of src/pair.ts, the arc helpers of src/round.ts
// and the shape check of src/route-shape.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pairPaths, offsetPair, joinFan } from '../dist/pair.js'
import { fillet, flatten, primsLength, splitPrims, planCorner, arcRadius, linesOf } from '../dist/round.js'
import { routeShapeIssues } from '../dist/route-shape.js'
import { near, nearPt } from './helpers.mjs'

const W = 0.2,
  G = 0.15,
  PITCH = W + G,
  H = PITCH / 2
const arcs = prims => prims.filter(p => p.kind === 'arc')

test('round: a fillet is tangent to both segments, its arc measured along the arc; split and flatten keep the ends', () => {
  const p = fillet(
    [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    [0, 2, 0],
  )
  assert.deepEqual(
    p.map(q => q.kind),
    ['line', 'arc', 'line'],
  )
  nearPt(p[1].from, [8, 0])
  nearPt(p[1].to, [10, 2])
  nearPt(p[1].center, [8, 2])
  assert.equal(p[1].cw, true, 'a right turn on the y-down screen is clockwise')
  near(primsLength(p), 8 + Math.PI + 8, 1e-12)
  const f = flatten(p)
  assert.deepEqual(
    [f[0], f.at(-1)],
    [
      [0, 0],
      [10, 10],
    ],
  )
  const [a, b] = splitPrims(p, 8 + Math.PI / 2)
  near(primsLength(a), 8 + Math.PI / 2, 1e-12)
  near(primsLength(b), 8 + Math.PI / 2, 1e-12)
  near(arcRadius(a.at(-1)), 2, 1e-12)
})

test('pair corners: a right angle becomes two concentric arcs, the centre radius the pitch, each track as long as its arc says', () => {
  const R = PITCH,
    r = pairPaths(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      W,
      G,
      { radii: [0, R, 0] },
    )
  const [P] = r.runsP,
    [N] = r.runsN
  const [ap] = arcs(P),
    [an] = arcs(N)
  nearPt(ap.center, an.center, 1e-12)
  nearPt(ap.center, [10 - R, R], 1e-12)
  // a right turn: P, on the left of travel, runs outside
  near(arcRadius(ap), R + H, 1e-12)
  near(arcRadius(an), R - H, 1e-12)
  near(r.lengthP, 2 * (10 - R) + ((R + H) * Math.PI) / 2, 1e-9)
  near(r.lengthN, 2 * (10 - R) + ((R - H) * Math.PI) / 2, 1e-9)
  // the skew of a rounded bend is 2 h times the turn, against 4 h tan(turn / 2) for the square one
  near(r.lengthP - r.lengthN, H * Math.PI, 1e-9)
  const sq = offsetPair(
    [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    W,
    G,
  )
  near(sq.skew, 4 * H, 1e-9)
})

test('pair corners: a 90 degree turn and two 45 degree turns back balance exactly when rounded, as they do not square', () => {
  const c = [
    [0, 0],
    [10, 0],
    [10, 10],
    [12, 12],
    [20, 12],
  ]
  const r = pairPaths(c, W, G, { radii: [0, PITCH, PITCH, PITCH, 0] })
  near(r.lengthP, r.lengthN, 1e-9)
  const sq = offsetPair(c, W, G)
  assert.ok(Math.abs(sq.lengthP - sq.lengthN) > 0.1)
})

test('pair corners: segments too short for the radius shrink it, down to the track width, then the corner is chamfered', () => {
  // a 0.5 mm jog between two right angles leaves 0.25 mm per corner: an arc of 0.25
  const r = pairPaths(
    [
      [0, 0],
      [10, 0],
      [10, 0.5],
      [20, 0.5],
    ],
    W,
    G,
    { radii: [0, PITCH, PITCH, 0] },
  )
  near(r.radii[0][1], 0.25, 1e-9)
  near(r.radii[0][2], 0.25, 1e-9)
  // 0.38 mm leaves 0.19, below the 0.2 mm width: chamfers, two vertices each, no arc
  const c = pairPaths(
    [
      [0, 0],
      [10, 0],
      [10, 0.38],
      [20, 0.38],
    ],
    W,
    G,
    { radii: [0, PITCH, PITCH, 0] },
  )
  assert.equal(arcs(c.runsP[0]).length, 0)
  assert.equal(c.centre[0].length, 6)
  // 0.3 mm leaves no room for the inner track to turn twice: square
  assert.equal(
    pairPaths(
      [
        [0, 0],
        [10, 0],
        [10, 0.3],
        [20, 0.3],
      ],
      W,
      G,
      { radii: [0, PITCH, PITCH, 0] },
    ).centre[0].length,
    4,
  )
})

test('pair corners: an arc that would meet other copper shrinks, then chamfers, then stays square; only the inner track is tested', () => {
  const c = [
    [0, 0],
    [10, 0],
    [10, 10],
  ]
  // an obstacle on the inside of the bend, near the inner track's arc at the full radius but clear of the smaller one
  const near1 = (pts, at, d) => pts.some(p => Math.hypot(p[0] - at[0], p[1] - at[1]) < d)
  const inner = [10 - H - 0.08, H + 0.08]
  const shrink = pairPaths(c, W, G, { radii: [0, PITCH, 0], free: (_k, t, pts) => !near1(pts, inner, 0.05) })
  assert.ok(shrink.radii[0][1] < PITCH - 1e-9 && shrink.radii[0][1] >= W - 1e-9, `${shrink.radii[0][1]}`)
  // blocked everywhere inside: square, the same tracks as without rounding
  const none = pairPaths(c, W, G, { radii: [0, PITCH, 0], free: (_k, t) => t === 0 })
  assert.deepEqual(none.radii[0], [0, 0, 0])
  near(none.lengthP - none.lengthN, 4 * H, 1e-9)
  // the outer track, P on a right turn, is never tested: it only moves towards N
  const outer = pairPaths(c, W, G, { radii: [0, PITCH, 0], free: (_k, t) => t === 1 })
  near(outer.radii[0][1], PITCH, 1e-12)
})

test('fans: a bend right at the pads runs the inner track straight on to its line and the outer at 67.5 degrees, never doubling back', () => {
  // pads 1.9 mm apart, a 45 degree bend 0.96 mm past them: the coupled run starts on the diagonal
  const r = pairPaths(
    [
      [30.5, 13.04],
      [30.5, 14],
      [27.75, 16.75],
      [27.75, 17.56],
    ],
    0.34,
    0.15,
    {
      startPads: [
        [31.45, 13.7],
        [29.55, 13.7],
      ],
      endPads: [
        [28, 17.12],
        [27.5, 17.12],
      ],
      radii: [0, 0, 0.49, 0],
    },
  )
  for (const run of [r.runsP[0], r.runsN[0]]) {
    const pts = flatten(run)
    for (let i = 2; i < pts.length; i++) {
      const u = [pts[i - 1][0] - pts[i - 2][0], pts[i - 1][1] - pts[i - 2][1]],
        v = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]
      assert.ok(u[0] * v[0] + u[1] * v[1] > 0, `a turn of more than 90 degrees at ${pts[i - 1]}`)
    }
  }
  // the inner track, N here, leaves its pad straight down until it meets its diagonal
  const n0 = r.runsN[0][0]
  near(n0.to[0], 29.55, 1e-9)
})

test('fans: a fan from pads a hair off the pitch runs shallow, no step narrower than the track', () => {
  const O = linesOf([
    [0, -H],
    [10, -H],
  ])
  const j = joinFan([-0.5, -H - 0.005], [1, 0], O, W, 2)
  const fan = j.prims[0]
  assert.ok(Math.hypot(fan.to[0] - fan.from[0], fan.to[1] - fan.from[1]) < W + 1e-9)
  assert.ok(Math.abs(Math.atan2(fan.to[1] - fan.from[1], fan.to[0] - fan.from[0])) <= (8 * Math.PI) / 180 + 1e-9)
})

const track = (pts, o = {}) => ({ kind: 'track', id: 1, layer: 'F.Cu', net: 'X', pts, width: 0.2, ...o })

test('shape check: a step narrower than the track, a track over itself and a turn back are found; a clean bend is not', () => {
  assert.deepEqual(
    routeShapeIssues(
      'r',
      [
        track([
          [0, 0],
          [5, 0],
          [5, 5],
        ]),
      ],
      [],
    ),
    [],
  )
  const jog = routeShapeIssues(
    'r',
    [
      track([
        [0, 0],
        [5, 0],
        [5.05, 0.05],
        [10, 0.05],
      ]),
    ],
    [],
  )
  assert.ok(
    jog.some(i => i.kind === 'notch'),
    JSON.stringify(jog),
  )
  const back = routeShapeIssues(
    'r',
    [
      track([
        [0, 0],
        [5, 0],
        [3, 0.01],
        [3, 5],
      ]),
    ],
    [],
  )
  assert.ok(back.some(i => i.kind === 'reverse'))
  const cross = routeShapeIssues(
    'r',
    [
      track([
        [0, 0],
        [5, 0],
        [5, 2],
        [2, 2],
        [2, -2],
      ]),
    ],
    [],
  )
  assert.ok(cross.some(i => i.kind === 'overlap'))
  // two pieces of one net that run over each other
  const two = routeShapeIssues(
    'r',
    [
      track([
        [0, 0],
        [5, 0],
      ]),
      track(
        [
          [3, 0],
          [8, 0],
        ],
        { id: 2 },
      ),
    ],
    [],
  )
  assert.ok(two.some(i => i.kind === 'overlap'))
})

test('shape check: a pair laid out with a via pair and rounded corners is one clean polyline per track and layer run', async () => {
  const { layPairJob } = await import('../dist/pair-lay.js')
  const job = {
    id: 'pair:1',
    nets: ['P', 'N'],
    w: 0.25,
    g: 0.2,
    via: { drill: 0.3, size: 0.6 },
    clearance: 0.2,
    copper: 0.2,
    holeClearance: 0.25,
    minWidth: 0.1,
    copperLayers: ['F.Cu', 'B.Cu'],
    pads: [null, null, null, null],
    centre: [
      [0, 0],
      [8, 0],
      [12, 0],
      [12, 8],
      [20, 8],
    ],
    vias: [1],
    layers: ['F.Cu', 'B.Cu'],
    auto: [false, false, false, false, false],
    radii: [0, 0, 0.45, 0.45, 0],
    startPads: [
      [0, -0.6],
      [0, 0.6],
    ],
    endPads: [
      [20, 7.4],
      [20, 8.6],
    ],
  }
  const laid = layPairJob(job)
  const tracks = laid.tracks.map((t, i) => ({ kind: 'track', id: i + 1, layer: t.layer, net: t.role, pts: t.pts, width: t.width, ...(t.prims ? { prims: t.prims } : {}) }))
  const vias = laid.vias.map((v, i) => ({ kind: 'via', id: 100 + i, layer: v.layers[0], net: v.role, at: v.at, drill: 0.3, size: 0.6, layers: v.layers }))
  assert.deepEqual(routeShapeIssues('route:1', tracks, vias), [])
  // the via sits on its track: each flare ends at the via centre, and meets the straight run at one vertex
  for (const v of vias) assert.ok(tracks.filter(t => t.net === v.net).some(t => [t.pts[0], t.pts.at(-1)].some(p => Math.hypot(p[0] - v.at[0], p[1] - v.at[1]) < 1e-9)))
  assert.ok(tracks.some(t => t.prims?.some(p => p.kind === 'arc')))
})
