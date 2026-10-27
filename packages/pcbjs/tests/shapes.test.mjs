// The path helpers of @pcbjs/lib: exact strings for the common cases, and outlines that compile to the expected box.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rect, roundedRect, circle, slot } from '@pcbjs/lib'
import { compileBoard } from '@pcbjs/compile'
import { parsePath } from '@pcbjs/compile/path'
import { gerberLayer } from '@pcbjs/export/gerber'
import { PCB, h } from './fixtures.mjs'
import { near } from './helpers.mjs'

const box = pts => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
const nearBox = (actual, expected, tol = 1e-6) => expected.forEach((v, i) => near(actual[i], v, tol, `box[${i}]: ${actual} vs ${expected}`))
const area = ring => Math.abs(ring.reduce((s, [x, y], i) => { const [u, v] = ring[(i + 1) % ring.length]; return s + x * v - u * y }, 0)) / 2
const outlineOf = (...d) => compileBoard(h(PCB, { name: 'Shapes' }, ...d.map(p => h('path', { layer: 'Edge.Cuts', d: p }))))

test('shapes: rect and roundedRect read as plain path data from the top-left corner', () => {
  assert.equal(rect(30, 20), 'M 0 0 H 30 V 20 H 0 Z')
  assert.equal(rect(4, 2, 1, 1.5), 'M 1 1.5 H 5 V 3.5 H 1 Z')
  assert.equal(roundedRect(30, 20, 2), 'M 2 0 H 28 A 2 2 0 0 1 30 2 V 18 A 2 2 0 0 1 28 20 H 2 A 2 2 0 0 1 0 18 V 2 A 2 2 0 0 1 2 0 Z')
  assert.equal(roundedRect(10, 4, 0), rect(10, 4))
  assert.equal(rect(0.1 + 0.2, 1), 'M 0 0 H 0.3 V 1 H 0 Z')
})

test('shapes: a roundedRect outline compiles to its box, with the corners cut', () => {
  const b = outlineOf(roundedRect(30, 20, 2))
  assert.equal(b.outline.length, 1)
  nearBox(box(b.outline[0]), [0, 0, 30, 20])
  near(area(b.outline[0]), 30 * 20 - (4 - Math.PI) * 4, 0.1)
  // a radius beyond half the short side is clamped: a 10 x 4 stadium
  nearBox(box(parsePath(roundedRect(10, 4, 5, 2, 3))[0].pts), [2, 3, 12, 7])
})

test('shapes: roundedRect, circle and slot reach the outline Gerber as lines and arcs', () => {
  const draws = (...d) => gerberLayer(outlineOf(...d), 'Edge.Cuts', '2026-01-01T00:00:00.000Z').text.split('\n').filter(l => /D01\*$/.test(l))
  const arcs = lines => lines.filter(l => /I-?\d+J-?\d+D01/.test(l)).length
  const rr = draws(roundedRect(30, 20, 2))
  assert.equal(rr.length, 8)
  assert.equal(arcs(rr), 4)
  assert.equal(arcs(draws(circle(10, 5, 5))), 2)
  assert.equal(arcs(draws(rect(30, 20), slot(5, 5, 15, 5, 2))), 2)
})

test('shapes: circle is centred on its point', () => {
  const b = outlineOf(circle(20, 10, 10))
  assert.equal(b.outline.length, 1)
  nearBox(box(b.outline[0]), [0, 0, 20, 20], 1e-3)
  near(area(b.outline[0]), Math.PI * 100, 0.3)
  nearBox(box(parsePath(circle(3))[0].pts), [-1.5, -1.5, 1.5, 1.5], 1e-3)
})

test('shapes: slot runs between two centres with round ends, at any angle', () => {
  nearBox(box(parsePath(slot(0, 0, 10, 0, 2))[0].pts), [-1, -1, 11, 1], 1e-3)
  nearBox(box(parsePath(slot(5, 2, 5, 8, 1))[0].pts), [4.5, 1.5, 5.5, 8.5], 1e-3)
  const d = Math.SQRT1_2 * 4
  near(area(parsePath(slot(0, 0, d, d, 1))[0].pts), 4 * 1 + Math.PI * 0.25, 0.02)
  assert.equal(slot(3, 3, 3, 3, 2), circle(2, 3, 3))
  // a slot inside a board is a second Edge.Cuts ring
  const b = outlineOf(rect(20, 10), slot(5, 5, 15, 5, 2))
  assert.equal(b.outline.length, 2)
  nearBox(box(b.outline[1]), [4, 4, 16, 6], 1e-3)
})

test('shapes: a pour from rect fills inside the outline', () => {
  const b = compileBoard(h(PCB, { name: 'Pour' }, h('path', { layer: 'Edge.Cuts', d: roundedRect(20, 10, 1) }), h('zone', { layer: 'B.Cu', net: 'GND', d: rect(20, 10), islands: 'keep' })))
  const zone = b.items.find(i => i.kind === 'zone')
  assert.ok(zone.fill.length > 0)
  nearBox(box(zone.outline[0]), [0, 0, 20, 10])
})

test('shapes: lengths must be numbers', () => {
  assert.throws(() => rect(NaN, 1), /rect: w must be a finite number/)
  assert.throws(() => circle('10'), /circle: d must be a finite number/)
})
