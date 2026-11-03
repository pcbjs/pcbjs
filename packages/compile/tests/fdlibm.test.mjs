// The browser compile's Math is Node's bit for bit: each port against Node's own function over inputs of every range it reduces in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as m from '../dist/fdlibm.js'

let seed = 7
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const spread = n => Array.from({ length: n }, () => (rnd() - 0.5) * 2 ** (rnd() * 24 - 12))
const special = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  Math.PI,
  -Math.PI,
  Math.PI / 2,
  Math.PI / 4,
  Math.PI / 12,
  1e-300,
  5e-324,
  1e300,
  Infinity,
  -Infinity,
  NaN,
  709.7,
  -745,
  2 ** -28,
  0.6744,
  22,
  710,
]
const inputs = {
  sin: [...special, ...spread(60000), ...Array.from({ length: 4000 }, () => (rnd() - 0.5) * 1.6e6)],
  cos: [...special, ...spread(60000), ...Array.from({ length: 4000 }, () => (rnd() - 0.5) * 1.6e6)],
  tan: [...special, ...spread(60000), ...Array.from({ length: 4000 }, () => (rnd() - 0.5) * 1.6e6)],
  atan: [...special, ...spread(60000)],
  acos: [...special, ...Array.from({ length: 60000 }, () => rnd() * 2 - 1)],
  exp: [...special, ...Array.from({ length: 60000 }, () => (rnd() - 0.5) * 1500), ...spread(20000)],
  expm1: [...special, ...Array.from({ length: 60000 }, () => (rnd() - 0.5) * 100), ...spread(20000)],
  log: [...special, ...Array.from({ length: 60000 }, () => 2 ** ((rnd() - 0.5) * 2000)), ...Array.from({ length: 20000 }, () => 1 + (rnd() - 0.5) * 1e-5)],
  log10: [...special, ...Array.from({ length: 60000 }, () => 2 ** ((rnd() - 0.5) * 2000))],
  cosh: [...special, ...Array.from({ length: 60000 }, () => (rnd() - 0.5) * 1430)],
  tanh: [...special, ...spread(60000), ...Array.from({ length: 4000 }, () => (rnd() - 0.5) * 50)],
}

const same = (a, b) => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))
const kind = m.mathKind()

test("fdlibm: Node's Math is one of the two kinds, plain on x86-64 and fused on arm64", () => {
  assert.notEqual(kind, null, 'this Node computes its Math neither as fdlibm nor as fdlibm with fused multiply-adds')
  assert.equal(kind, process.arch === 'arm64' ? 'fused' : 'plain')
})

for (const [name, xs] of Object.entries(inputs))
  test(`fdlibm: ${name} gives Node's Math.${name} bit for bit`, () => {
    m.setMathKind(kind)
    const bad = xs.filter(x => !same(m[name](x), Math[name](x)))
    assert.deepEqual(
      bad.slice(0, 5).map(x => [x, m[name](x), Math[name](x)]),
      [],
      `${bad.length} of ${xs.length} differ`,
    )
  })

test("fdlibm: atan2 gives Node's Math.atan2 bit for bit, the axes and infinities included", () => {
  const vals = [0, -0, 1, -1, Infinity, -Infinity, NaN, 1e-300, 1e300]
  const pairs = [
    ...vals.flatMap(y => vals.map(x => [y, x])),
    ...Array.from({ length: 60000 }, () => [(rnd() - 0.5) * 2 ** (rnd() * 40 - 20), (rnd() - 0.5) * 2 ** (rnd() * 40 - 20)]),
  ]
  m.setMathKind(kind)
  const bad = pairs.filter(([y, x]) => !same(m.atan2(y, x), Math.atan2(y, x)))
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} of ${pairs.length} differ`)
})
