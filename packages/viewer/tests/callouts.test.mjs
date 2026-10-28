// The exploded view's callouts: each layer's anchor is the outline's rightmost point on screen for the camera, the labels one column right of the rightmost anchor;
// a hovered layer turns the others see-through, and a selection turns the board see-through.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DIMMED, REST, anchor, calloutOpacity, column, hull, leader, project } from '../src/scene/callouts.ts'
import { layerDimmed, slabState, translucent } from '../src/scene/focus.ts'

// column-major 4x4 helpers, as THREE.Matrix4.elements
const mul = (a, b) => {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
const perspective = (fov, aspect, near, far) => {
  const f = 1 / Math.tan(fov / 2),
    nf = 1 / (near - far)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]
}
/** The view matrix of a camera at `eye` looking at `at`, z up. */
const lookAt = (eye, at, up = [0, 0, 1]) => {
  const sub = (a, b) => a.map((v, i) => v - b[i]),
    norm = v => {
      const l = Math.hypot(...v)
      return v.map(x => x / l)
    }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
  const z = norm(sub(eye, at)),
    x = norm(cross(up, z)),
    y = cross(z, x)
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]
}
const W = 800,
  H = 600
const camera = (eye, at = [15, -10, 0]) => mul(perspective(Math.PI / 4, W / H, 0.1, 1000), lookAt(eye, at))
// a 30 x 20 board in three's frame, x right, y up: its outline with a notch the hull leaves out
const outline = [
  [0, 0],
  [30, 0],
  [30, -20],
  [16, -20],
  [15, -12],
  [14, -20],
  [0, -20],
]

test('the hull keeps the corners and drops the notch', () => {
  const h = hull(outline)
  assert.equal(h.length, 4)
  assert.ok(!h.some(([x, y]) => x === 15 && y === -12))
})

test('a point projects through the camera matrix to CSS pixels; behind the camera is null', () => {
  const m = camera([15, -40, 50])
  const c = project(m, 15, -10, 0, W, H)
  assert.ok(Math.abs(c[0] - W / 2) < 1e-6 && Math.abs(c[1] - H / 2) < 1e-6, 'the target is the centre')
  const r = project(m, 30, -10, 0, W, H)
  assert.ok(r[0] > W / 2 && Math.abs(r[1] - H / 2) < 1e-6, 'x right is right on screen from above')
  assert.equal(project(m, 15, -70, 100, W, H), null)
})

test('the anchor is the rightmost hull vertex on screen, and follows the camera round', () => {
  const ring = hull(outline)
  const front = camera([15, -60, 30])
  const a = anchor(front, ring, 0, W, H)
  const right = ring.map(([x, y]) => project(front, x, y, 0, W, H)).reduce((m, p) => (p[0] > m[0] ? p : m))
  assert.deepEqual(a, right)
  // from the south the right edge is x = 30, nearest corner first: the near right corner (30, -20)
  assert.deepEqual(a, project(front, 30, -20, 0, W, H))
  // orbit to the east, looking west: screen right is the north edge now, its corner nearer the camera
  const east = camera([80, -10, 30])
  assert.deepEqual(anchor(east, ring, 0, W, H), project(east, 30, 0, 0, W, H))
  // a layer higher in the stack anchors higher on screen
  assert.ok(anchor(front, ring, 6, W, H)[1] < a[1])
})

test('the labels stand in one column, the rightmost anchor x plus the gap, each beside its own anchor', () => {
  const at = [
    [100, 100],
    [140, 200],
    [120, 300],
  ]
  const placed = column(at, 18, 24)
  assert.ok(placed.every(p => p.label[0] === 140 + 24))
  assert.deepEqual(
    placed.map(p => p.at),
    at,
    'each leader starts at its own anchor',
  )
  assert.deepEqual(
    placed.map(p => p.label[1]),
    [100, 200, 300],
  )
  const same = column(
    [
      [100, 300],
      [90, 300],
      [80, 300],
    ],
    18,
    24,
  )
  assert.deepEqual(
    same.map(p => p.label[1]).sort((a, b) => a - b),
    [282, 300, 318],
    'centred on the shared anchor, one row apart',
  )
  // close anchors push apart but keep their order top to bottom
  const close = column(
    [
      [100, 105],
      [102, 100],
    ],
    18,
    24,
  )
  assert.ok(close[1].label[1] < close[0].label[1] && close[0].label[1] - close[1].label[1] >= 18)
  assert.deepEqual(column([], 18, 24), [])
})

test('a leader is one plain line from its anchor to a few px short of its label', () => {
  const p = { at: [100, 120], label: [164, 100] }
  assert.equal(leader(p, 3), 'M100.0 120.0L161.0 100.0')
  const view3d = readFileSync(new URL('../src/View3D.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(view3d, /circle r=|class="ico"|GLYPH/, 'no endpoint dots and no layer icons')
  assert.match(view3d, /createElementNS\('http:\/\/www.w3.org\/2000\/svg', 'path'\)/)
})

test('callouts are faint at rest, opaque only for the hovered layer, fainter for the others', () => {
  assert.equal(REST, 0.45)
  assert.equal(calloutOpacity('F.Cu', null, true), 0.45)
  assert.equal(calloutOpacity('F.Cu', 'F.Cu', true), 1)
  assert.equal(calloutOpacity('B.Cu', 'F.Cu', true), DIMMED)
  assert.ok(DIMMED < REST)
  assert.equal(calloutOpacity('F.Cu', 'F.Cu', false), 0, 'hidden while the stack is closed')
})

test('a hovered layer dims every other group but the overlays; no hover dims nothing', () => {
  assert.equal(layerDimmed('F.Cu', null), false)
  assert.equal(layerDimmed('F.Cu', 'F.Cu'), false)
  assert.equal(layerDimmed('B.Cu', 'F.Cu'), true)
  assert.equal(layerDimmed('diel:0', 'F.Cu'), true)
  assert.equal(layerDimmed('bodies:F', 'F.Cu'), true)
  assert.equal(layerDimmed('overlay', 'F.Cu'), false)
  assert.equal(slabState({ inner: false, translucent: false, dimmed: true, focus: false }), 'see', "another layer's slab is see-through")
  assert.equal(slabState({ inner: false, translucent: false, dimmed: false, focus: false }), null, "the hovered layer's slab stays")
})

test('a pinned net, a selected part, pad or group turns the board see-through; hover and the fade switched off do not', () => {
  assert.equal(translucent({ net: 'GND' }, true), true)
  assert.equal(translucent({ ref: 'Q1' }, true), true, 'a part, or a pad of it')
  assert.equal(translucent({ refs: ['R1', 'D1'] }, true), true, 'a group')
  assert.equal(translucent({ refs: [] }, true), false)
  assert.equal(translucent({}, true), false, 'hover sets none of these')
  assert.equal(translucent({ ref: 'Q1' }, false), false)
  assert.equal(slabState({ inner: false, translucent: true, dimmed: false, focus: true }), 'fade', 'the substrate under a selection fades with the rest')
  assert.equal(slabState({ inner: false, translucent: false, dimmed: false, focus: true }), 'dim', 'a source highlight only dims it')
  assert.equal(slabState({ inner: true, translucent: true, dimmed: false, focus: true }), 'fade', 'inner copper on show keeps it clear')
})
