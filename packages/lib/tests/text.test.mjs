import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strokeText, SIMPLEX, SIMPLEX_CAP } from '../dist/fonts.js'
import { near } from './helpers.mjs'

const opts = (o = {}) => ({ size: 1, thickness: 0.15, anchor: 'start', ...o })
const box = strokes => {
  const pts = strokes.flat()
  const xs = pts.map(p => p[0]),
    ys = pts.map(p => p[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

test('font: 95 glyphs, every printable ASCII glyph but space has a stroke', () => {
  assert.equal(SIMPLEX.length, 95)
  for (let c = 33; c <= 126; c++) {
    const t = strokeText(String.fromCharCode(c), opts())
    assert.ok(t.strokes.length >= 1, `no stroke for ${String.fromCharCode(c)}`)
    assert.ok(
      t.strokes.every(s => s.length >= 2),
      `a one-point stroke in ${String.fromCharCode(c)}`,
    )
    assert.deepEqual(t.missing, [])
  }
  assert.equal(strokeText(' ', opts()).strokes.length, 0)
  assert.ok(strokeText(' ', opts()).width > 0)
})

test('strokeText: H is exactly the cap size tall, baseline at y = 0, y down', () => {
  assert.equal(SIMPLEX_CAP, 21)
  for (const size of [0.8, 1, 1.5]) {
    const t = strokeText('H', opts({ size }))
    const b = box(t.strokes)
    near(b.y1, 0, 1e-6)
    near(b.y1 - b.y0, size, 1e-6)
    near(t.height, size, 1e-6)
  }
})

test('strokeText: coordinates are rounded to 1 nm', () => {
  for (const [x, y] of strokeText('Blinky 0.123', opts({ size: 0.77 })).strokes.flat()) {
    near(x * 1e6, Math.round(x * 1e6), 1e-6)
    near(y * 1e6, Math.round(y * 1e6), 1e-6)
  }
})

test('strokeText: anchors shift the layout by half and all of the width', () => {
  const s = strokeText('LED1', opts()),
    m = strokeText('LED1', opts({ anchor: 'middle' })),
    e = strokeText('LED1', opts({ anchor: 'end' }))
  assert.ok(s.width > 0)
  near(box(m.strokes).x0, box(s.strokes).x0 - s.width / 2, 2e-6)
  near(box(e.strokes).x0, box(s.strokes).x0 - s.width, 2e-6)
  near(box(e.strokes).x1, box(s.strokes).x1 - s.width, 2e-6)
  // H has equal side bearings, so a middle-anchored H is centred on x = 0
  const h = box(strokeText('H', opts({ anchor: 'middle' })).strokes)
  near(h.x0, -h.x1, 2e-6)
})

test('strokeText: letter spacing widens the line', () => {
  const a = strokeText('AB', opts()),
    b = strokeText('AB', opts({ letterSpacing: 0.5 }))
  near(b.width - a.width, 0.5, 1e-6)
})

test('strokeText: lines stack downwards by the line height', () => {
  const one = strokeText('H', opts()),
    two = strokeText('H\nH', opts({ lineHeight: 2 }))
  near(two.height, 3, 1e-6)
  assert.equal(two.strokes.length, 2 * one.strokes.length)
  const second = box(two.strokes.slice(one.strokes.length))
  near(second.y1, 2, 1e-6)
  near(box(strokeText('H\nH', opts()).strokes).y1, 1.6, 1e-6)
  // each line is anchored on its own
  const w = strokeText('H\nHHH', opts({ anchor: 'end' }))
  near(box(w.strokes.slice(0, one.strokes.length)).x1, box(one.strokes).x1 - one.width, 1e-6)
})

test('strokeText: a character outside the font is a box and is reported', () => {
  const t = strokeText('µ', opts())
  assert.deepEqual(t.missing, ['µ'])
  assert.equal(t.strokes.length, 1)
  const r = t.strokes[0]
  assert.equal(r.length, 5)
  assert.deepEqual(r[0], r[4])
  near(box([r]).y1 - box([r]).y0, 1, 1e-6)
})

test('strokeText: middle dot and degree have glyphs', () => {
  for (const c of ['·', '°']) {
    const t = strokeText(c, opts())
    assert.deepEqual(t.missing, [], c)
    assert.ok(t.strokes.length >= 1, c)
  }
  // the middle dot sits at about half the cap height
  const d = box(strokeText('·', opts()).strokes)
  near((d.y0 + d.y1) / 2, -0.5, 0.05)
})

test('strokeText: the demo title lays out with a positive width', () => {
  const t = strokeText('Blinky · pcbjs', opts({ anchor: 'middle' }))
  assert.deepEqual(t.missing, [])
  assert.ok(t.width > 5 && t.strokes.length > 10)
})
