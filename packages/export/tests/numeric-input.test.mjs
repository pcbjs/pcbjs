import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, resetDefaults } from '@pcbjs/core'
import { rect } from '@pcbjs/lib'
import { compileBoard } from '@pcbjs/compile'
import { buildFab, excellon, gerberLayer, checkFab } from '../dist/index.js'

const DATE = '2026-01-01T00:00:00.000Z'
const board = props => {
  resetDefaults()
  return compileBoard(
    h(PCB, { name: 'Numeric' }, h('path', { layer: 'Edge.Cuts', d: rect(20, 20) }), h('pad', { num: '', type: 'npth', at: '-2 0 -90', size: 2, drill: 1, ...props })),
  )
}

test('pad axes reject invalid dimensions before geometry', () => {
  for (const field of ['size', 'drill'])
    for (const value of [NaN, Infinity, -Infinity, '1e309mm', 0, -1]) {
      for (const input of [value, [1, value], [value, 1]]) assert.throws(() => board({ [field]: input }), new RegExp(`${field}.*finite|${field}.*positive`))
    }
  const b = board({ size: [2, 3], drill: [1, 2] })
  const p = b.items.find(i => i.kind === 'pad')
  assert.deepEqual(p.at, [-2, 0])
  assert.deepEqual(p.drill, [1, 2])
  assert.ok(excellon(b, false, DATE).text.includes('G85'))
})

test('export entry points reject corrupted Board geometry and dimensions', () => {
  for (const [field, value] of [
    ['drill', [NaN, 1]],
    ['drill', [1, 0]],
    ['size', [-1, 2]],
    ['drill', ['1', 2]],
    ['size', []],
    ['at', [Infinity, 0]],
    ['rot', -Infinity],
    [
      'poly',
      [
        [0, NaN],
        [1, 0],
        [1, 1],
      ],
    ],
  ]) {
    const b = board({})
    const copy = { ...b, items: b.items.map(i => (i.kind === 'pad' ? { ...i, [field]: value } : i)) }
    for (const fn of [b => buildFab(b, DATE), b => excellon(b, false, DATE), b => gerberLayer(b, 'F.Cu', DATE), b => checkFab(b, [])])
      assert.throws(() => fn(copy), /board.items.*finite|board.items.*positive|board.items.*axes/)
  }
})

test('manufacturing serialization rejects unrepresentable coordinates and safely reduces finite rotations', () => {
  const b = board({ drill: [1, 2] })
  const change = props => ({ ...b, items: b.items.map(i => (i.kind === 'pad' ? { ...i, ...props } : i)) })
  const huge = change({ at: [Number.MAX_VALUE, 0] })
  for (const fn of [b => excellon(b, false, DATE), b => gerberLayer(b, 'Edge.Cuts', DATE), b => buildFab(b, DATE)]) assert.throws(() => fn(huge), /coordinate range/)
  const rotation = Number.MAX_VALUE
  const rotated = excellon(change({ rot: rotation }), false, DATE)
  assert.equal(rotated.text, excellon(change({ rot: rotation % 360 }), false, DATE).text)
  assert.doesNotMatch(rotated.text, /NaN|Infinity/)
  for (const end of rotated.tools[0].holes.flatMap(h => [h.x, h.y, ...(h.end ?? [])])) assert.ok(Number.isFinite(end))
  assert.throws(() => excellon(change({ drill: [Number.MAX_VALUE, Number.MAX_VALUE] }), false, DATE), /representable/)
})
