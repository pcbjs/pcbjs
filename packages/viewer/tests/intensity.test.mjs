// The strength of a highlight falls with the item's area: a track keeps the full tint, a pour gets a faint one and an outline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HL_MIN, HL_OUTLINE_BELOW, HL_REF_AREA, HL_STEPS, hlStep, hlStrength, ringsArea } from '../src/scene/intensity.ts'

test('full strength up to the reference area, then 1 / sqrt(area / ref), clamped', () => {
  assert.equal(hlStrength(0.3 * 10), 1, 'a 10 mm track of 0.3 mm')
  assert.equal(hlStrength(HL_REF_AREA), 1)
  assert.equal(hlStrength(undefined), 1)
  assert.equal(hlStrength(NaN), 1)
  assert.ok(Math.abs(hlStrength(4 * HL_REF_AREA) - 0.5) < 1e-12, 'halves at four times the reference')
  assert.equal(hlStrength(30 * 20), Math.max(HL_MIN, Math.sqrt(HL_REF_AREA / 600)), 'the Blinky pour')
  assert.equal(hlStrength(55 * 71), HL_MIN, 'the led-matrix pour')
  assert.equal(hlStrength(1e6, 0.35), 0.35, 'a custom floor')
})

test('smooth and falling: no jump at the reference area, never rising with area', () => {
  let prev = 1
  for (let a = 0.5; a < 5000; a *= 1.05) {
    const s = hlStrength(a)
    assert.ok(s <= prev + 1e-12 && s >= HL_MIN && s <= 1)
    assert.ok(prev - s < 0.05, `step at ${a} mm²`)
    prev = s
  }
  // a pour is weak enough for its outline, a track is not
  assert.ok(hlStrength(600) < HL_OUTLINE_BELOW)
  assert.ok(hlStrength(3) >= HL_OUTLINE_BELOW)
})

test('strength steps', () => {
  assert.equal(hlStep(1), 1)
  assert.equal(hlStep(0), 1 / HL_STEPS)
  assert.equal(hlStep(0.5), 0.5)
  assert.equal(hlStep(0.52), 0.5)
  assert.equal(hlStep(2), 1)
})

test('ring areas: a square, a hole winding against it, a hole winding with it, two islands', () => {
  const sq = (x, y, w, cw = false) => { const r = [[x, y], [x + w, y], [x + w, y + w], [x, y + w]]; return cw ? r.reverse() : r }
  assert.equal(ringsArea([sq(0, 0, 10)]), 100)
  assert.equal(ringsArea([sq(0, 0, 10, true)]), 100)
  assert.equal(ringsArea([sq(0, 0, 10), sq(2, 2, 2, true)]), 96)
  assert.equal(ringsArea([sq(0, 0, 10), sq(2, 2, 2)]), 104)
  assert.equal(ringsArea([sq(0, 0, 3), sq(5, 5, 3)]), 18)
  assert.equal(ringsArea([sq(0, 0, 3), sq(5, 5, 3, true)]), 18)
  assert.equal(ringsArea([]), 0)
})
