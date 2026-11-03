// The 2D highlight per state, read back from the classes of the overlay markup: hover, selected, anchor and context each draw
// what they name, a part by its courtyard, a stale member half-opaque and dashed, a track with its own width.
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
const { overlay, statesOf } = await import('../src/hl2d.ts')
const { drawnOf, emptySelection } = await import('../src/selection.ts')

const B = fixture()
const all = new Set(['F.Cu', 'F.CrtYd'])

test('each state draws what it names under its own class, in drawing order', () => {
  const sel = { ...emptySelection('Fx'), refs: ['G/R1', 'CH1/R01/1'], anchor: 'CH1/R01/1' }
  const d = drawnOf(B, sel)
  const markup = overlay(B, all, [
    { state: 'ctx', nets: [d.context] },
    { state: 'sel', parts: [...d.parts].filter(p => !d.anchor.parts.has(p)), ids: [...d.ids].filter(i => !d.anchor.ids.has(i)) },
    { state: 'anchor', parts: d.anchor.parts, ids: d.anchor.ids },
    { state: 'hover', ids: [10] },
  ])
  const by = statesOf(markup)
  assert.deepEqual(by.get('hl-ctx'), ['5', '9'], 'the anchor pad net S1: its pad and its routed track')
  assert.deepEqual(by.get('hl-sel'), ['R1'], 'a part outlines its courtyard')
  assert.deepEqual(by.get('hl-anchor'), ['5'], 'the anchor pad alone')
  assert.deepEqual(by.get('hl-hover'), ['10'])
  const order = ['hl-ctx', 'hl-sel', 'hl-anchor', 'hl-hover'].map(c => markup.indexOf(`class="${c}`))
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    'context under the selection, the anchor over it, the hover on top',
  )
  assert.match(markup, /class="hl-case hl-case-anchor"/, 'the selection sits on a casing')
  assert.doesNotMatch(markup, /hl-case-hover|hl-case-ctx/, 'hover and context have none')
})

test('a part without a courtyard is a box around its extent; a track keeps its width; a stale member is marked', () => {
  const markup = overlay(B, all, [{ state: 'sel', parts: ['R201'], ids: [10], stale: new Set([10]) }])
  assert.match(markup, /<rect class="hl-sel" data-hl="R201" x="13.75" y="3.75" width="2.5" height="2.5"\/>/)
  assert.match(markup, /class="hl-sel hl-line hl-stale" data-hl="10" style="--w:0.2px"/)
  assert.match(markup, /class="hl-in hl-in-sel" style="--w:0.2px;--c:#c83434"/, 'the copper at its true width in its layer colour over the outline')
  assert.deepEqual(statesOf(markup).get('hl-sel hl-stale'), ['10'])
})

test('a hidden layer draws nothing; a net is its copper only', () => {
  assert.equal(overlay(B, new Set(['F.CrtYd']), [{ state: 'sel', ids: [5] }]), '')
  const net = statesOf(overlay(B, all, [{ state: 'anchor', nets: ['GND'] }]))
  assert.deepEqual(net.get('hl-anchor'), ['4', '6', '8'])
})
