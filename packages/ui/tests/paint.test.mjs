// The paint of a view: the selection split into members, anchor and context, the hover as what a click would select, and the same sets
// while nothing changed, so a view tells the difference by identity.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { fixture } from './fixture-board.mjs'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { changedLit, DARK, hoverLit, keptOf, paintOf, sameLit } = await import('../src/paint.ts')
const { drawnOf, emptySelection, selectRefs } = await import('../src/selection.ts')

const sorted = s => [...s].sort()
const b = fixture()
const none = new Set()

test('a selection splits into members, the anchor and its net as context', () => {
  const sel = selectRefs(emptySelection(), ['R1', 'R1/2'], 'R1/2')
  const p = paintOf(b, drawnOf(b, sel), DARK, null, undefined, none, true)
  assert.deepEqual(sorted(p.sel.parts), ['R1'])
  assert.deepEqual(sorted(p.anchor.ids), [2])
  assert.deepEqual(sorted(p.ctx.nets), ['B'])
  assert.equal(p.fade, true)
  assert.deepEqual(sorted(keptOf(p).ids), [2])
  assert.deepEqual(sorted(keptOf(p).nets), ['B'])
})

test('the same drawn selection gives the same sets; nothing drawn fades nothing', () => {
  const d = drawnOf(b, selectRefs(emptySelection(), ['R2']))
  const a = paintOf(b, d, DARK, null, undefined, none, true)
  const c = paintOf(b, d, DARK, null, undefined, none, true)
  assert.equal(a.anchor, c.anchor)
  assert.equal(a.sel, DARK)
  assert.equal(paintOf(b, drawnOf(b, emptySelection()), DARK, null, undefined, none, true).fade, false)
  assert.equal(paintOf(b, d, DARK, null, undefined, none, false).fade, false)
})

test('a hover lights what a click would select unless it is a member, and panel hovers beside it', () => {
  const sel = selectRefs(emptySelection(), ['R1'])
  assert.deepEqual(sorted(hoverLit(b, sel, 'R2').parts), ['R2'])
  assert.equal(hoverLit(b, sel, 'R1'), DARK)
  const h = hoverLit(b, sel, null, { net: 'GND', refs: ['R101'], remote: { ids: [9], refs: ['R1'], net: null } })
  assert.deepEqual(sorted(h.nets), ['GND'])
  assert.deepEqual(sorted(h.parts), ['R101'])
  assert.deepEqual(sorted(h.ids), [9])
})

test('the difference of two lit sets, and their equality by members', () => {
  const a = { ids: new Set([1, 2]), parts: new Set(['R1']), nets: new Set() }
  const c = { ids: new Set([2, 3]), parts: new Set(['R1']), nets: new Set(['GND']) }
  const d = changedLit(a, c)
  assert.deepEqual(sorted(d.ids), [1, 3])
  assert.deepEqual(sorted(d.parts), [])
  assert.deepEqual(sorted(d.nets), ['GND'])
  assert.equal(sameLit(a, { ids: new Set([2, 1]), parts: new Set(['R1']), nets: new Set() }), true)
  assert.equal(sameLit(a, c), false)
})
