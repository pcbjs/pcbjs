// The sun's glint in the glossy mask stays out of the preset views: it once sat beside every part a --select shot framed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FOCUS_DIR, ISO_DIR, SUN, UNDER, glintAngle } from '../src/scene/lights.ts'

test("the sun's mirror image lies outside the iso view, a part's close-up and the top and bottom views", () => {
  // the view is 35 degrees tall and about 27 degrees off axis to the side at most
  assert.ok(glintAngle(SUN, FOCUS_DIR) > 45, `focus ${glintAngle(SUN, FOCUS_DIR)}`)
  assert.ok(glintAngle(SUN, ISO_DIR) > 45, `iso ${glintAngle(SUN, ISO_DIR)}`)
  assert.ok(glintAngle(SUN, [0, 0, 1]) > 30, `top ${glintAngle(SUN, [0, 0, 1])}`)
  assert.ok(glintAngle(UNDER, [0, 0, -1]) > 30, `bottom ${glintAngle(UNDER, [0, 0, -1])}`)
  // the old sun, from behind on the left, put its glint 10 degrees off a close-up's axis
  assert.ok(glintAngle([-40, 60, 100], FOCUS_DIR) < 15)
})
