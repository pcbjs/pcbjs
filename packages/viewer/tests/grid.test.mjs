// The background grid: the step rule of 2D and 3D, the schematic's grid units, the paths drawn and the tones three reads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridPaths, gridStep, parseColor, schStep } from '../src/grid.ts'

test('1 and 10 mm at normal zoom, 0.1 and 1 zoomed in, 10 and 100 zoomed out', () => {
  assert.deepEqual(gridStep(15), { minor: 1, major: 10 })
  assert.deepEqual(gridStep(8), { minor: 1, major: 10 })
  assert.deepEqual(gridStep(80), { minor: 0.1, major: 1 })
  assert.deepEqual(gridStep(400), { minor: 0.1, major: 1 })
  assert.deepEqual(gridStep(7.9), { minor: 10, major: 100 })
  assert.deepEqual(gridStep(0.5), { minor: 10, major: 100 })
})

test('the schematic grid is the drawing grid and ten of it', () => {
  assert.deepEqual(schStep(2.54), { minor: 2.54, major: 25.4 })
})

test('lines through the origin, minor ones not doubled under the major, pixel centred', () => {
  // 100 by 50 mm at 10 px per mm
  const p = gridPaths([-5, -5, 100, 50], 0.1, { minor: 1, major: 10 })
  const xs = d => [...d.matchAll(/M(-?[\d.]+) -5V/g)].map(m => +m[1])
  const major = xs(p.major)
  assert.deepEqual(major.map(Math.round), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
  assert.ok(major.every(x => Math.abs(((x + 5) / 0.1) % 1 - 0.5) < 1e-6), 'on pixel centres')
  const minor = xs(p.minor).map(Math.round)
  assert.equal(minor.length, 101 - 10, "-5 to 95 but the majors")
  assert.ok(!minor.includes(10))
  assert.match(p.axes, /^M0\.05 -5V45M-5 0\.05H95$/)
})

test('a step under 4 screen pixels is left out, and an origin off screen draws no axis', () => {
  const p = gridPaths([20, 20, 100, 50], 0.5, { minor: 1, major: 10 })
  assert.equal(p.minor, '')
  assert.notEqual(p.major, '')
  assert.equal(p.axes, '')
})

test('the tokens as three takes them', () => {
  assert.deepEqual(parseColor('rgba(30, 38, 52, 0.1)'), { hex: '#1e2634', alpha: 0.1 })
  assert.deepEqual(parseColor(' #ECEEF1 '), { hex: '#eceef1', alpha: 1 })
  assert.deepEqual(parseColor('#abc'), { hex: '#aabbcc', alpha: 1 })
  assert.equal(parseColor('color-mix(in srgb, red, blue)'), null)
})
