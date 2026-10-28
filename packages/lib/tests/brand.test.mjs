// <Brand>: the silk mark and wordmark, sized by its ink height and never thinner than the board's silkMinWidth.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { Brand, brandMinHeight, OSHPARK } from '../dist/index.js'
import { near } from './helpers.mjs'

const board = (brand, rules) =>
  compileBoard(h(PCB, { name: 'B', ...(rules ? { rules } : {}) }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 30 }), h(Brand, brand)), { routeCache: false })
const ink = b => b.items.filter(i => i.kind === 'graphic' && /SilkS$/.test(i.layer))
function bounds(items) {
  const r = [Infinity, Infinity, -Infinity, -Infinity]
  for (const g of items)
    for (const [x, y] of g.paths.flat()) {
      const w = g.fill ? 0 : g.width / 2
      r[0] = Math.min(r[0], x - w)
      r[1] = Math.min(r[1], y - w)
      r[2] = Math.max(r[2], x + w)
      r[3] = Math.max(r[3], y + w)
    }
  return r
}

test('Brand: the ink is height high and centred on at; the mark alone is square', () => {
  const [x0, y0, x1, y1] = bounds(ink(board({ at: '20 15', height: 6 })))
  near(y1 - y0, 6, 0.01)
  near((x0 + x1) / 2, 20, 0.01)
  near((y0 + y1) / 2, 15, 0.01)
  near(x1 - x0, (6 * (274.78 - 6)) / 84, 0.02)
  const m = bounds(ink(board({ at: '20 15', height: 5, only: 'mark' })))
  near(m[2] - m[0], 5, 0.01)
  near(m[3] - m[1], 5, 0.01)
  const w = ink(board({ at: '20 15', height: 4, only: 'wordmark' }))
  near(bounds(w)[3] - bounds(w)[1], 4, 0.01)
})

test('Brand: filled mark and pcb, js stroked; a B. layer mirrors it to read from below; rot turns it', () => {
  const f = ink(board({ at: '20 15', height: 5 }))
  assert.deepEqual(
    f.map(g => [g.layer, g.fill]),
    [
      ['F.SilkS', true],
      ['F.SilkS', false],
    ],
  )
  const b = ink(board({ at: '20 15', height: 5, layer: 'B.SilkS' }))
  assert.ok(b.every(g => g.layer === 'B.SilkS'))
  near(bounds(b)[0], 40 - bounds(f)[2], 0.01)
  const [x0, y0, x1, y1] = bounds(ink(board({ at: '20 15', height: 5, rot: 90 })))
  near(x1 - x0, 5, 0.01)
  assert.ok(y1 - y0 > 13)
})

test('Brand: at the minimum height the js outline meets silkMinWidth; below it is a compile error naming the minimum', () => {
  for (const rules of [undefined, OSHPARK]) {
    const silk = rules?.silkMinWidth ?? 0.15
    const min = brandMinHeight(silk)
    const b = board({ at: '20 15', height: min }, rules)
    assert.ok(
      ink(b).every(g => g.fill || g.width >= silk),
      'stroke at least silkMinWidth',
    )
    assert.deepEqual(
      b.drc.filter(d => d.rule === 'silk-width'),
      [],
    )
    assert.throws(() => board({ at: '20 15', height: min - 0.05 }, rules), new RegExp(`below ${min} mm`))
  }
  assert.ok(brandMinHeight(0.15, 'mark') < brandMinHeight(0.15))
  assert.throws(() => board({ only: 'logo' }), /only must be "mark" or "wordmark"/)
})

test('Brand: placed on a scratch board it adds no finding', () => {
  const b = board({ at: '20 15', height: 5 })
  assert.deepEqual(
    b.drc.map(d => d.rule),
    [],
  )
})
