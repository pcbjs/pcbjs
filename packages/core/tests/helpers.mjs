import assert from 'node:assert/strict'

export function near(actual, expected, tol = 1e-9, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, msg ?? `expected ${actual} to be within ${tol} of ${expected}`)
}

export function nearPt(actual, expected, tol = 1e-9) {
  near(actual[0], expected[0], tol, `x: expected [${actual}] near [${expected}]`)
  near(actual[1], expected[1], tol, `y: expected [${actual}] near [${expected}]`)
}
