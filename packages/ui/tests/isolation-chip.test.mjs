// The chip in an isolation names the definition, whose values it is shown with and how many instances follow a write, with the picker; a definition placed once has no picker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { joinSite } from '@pcbjs/core/site-facets'
import * as ui from '../dist/index.js'
import { fixture } from './fixture-board.mjs'

const site = () => {
  const f = fixture()
  f.schematic.circuits = f.schematic.circuits.map(c => (c.circuit === 'Chan' ? { ...c, layout: 'ChanRow' } : c))
  return joinSite({ meta: { ...f, copper: 2, thickness: 1.6, viewBox: [0, 0, 30, 30], bbox: { x: 0, y: 0, w: 30, h: 30 }, outline: [], airwires: [], sourcingTags: [] } })
}
const text = html =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')

test('first group focus shows separate layout actions; second click enters instance layout with disabled active action', async () => {
  const b = site(), store = ui.useBoard(b)
  const hit = { kind: 'pad', id: 5, ref: 'R101', net: 'S1' }
  const render = () => renderToString(createSSRApp({ render: () => h(ui.PathChip, { board: b }) }))
  store.pick(hit, { shift: false, deep: false })
  let html = await render()
  assert.match(html, /data-ui="PathChip.LayoutActions"/)
  assert.match(text(html), /Instance layout\s*Library layout/)
  assert.doesNotMatch(html, /class="chip act"|isolation-choice|Instance whose values are shown/)
  assert.equal(store.sel.isolate, null)
  store.pick(hit, { shift: false, deep: false })
  assert.equal(store.sel.isolate.mode, 'instance')
  assert.equal(store.sel.isolateChoice ?? null, null)
  html = await render()
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="Edit instance layout"/)
  assert.match(text(html), /Instance layout: ChanRow/)
  store.chooseIsolation('library')
  html = await render()
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="Edit library layout"/)
  assert.match(text(html), /Library layout: ChanRow/)
  assert.doesNotMatch(text(html), /instances follow|shown with|writes /)
  store.escapeSel()
  assert.deepEqual([store.sel.isolate, store.sel.refs], [null, ['CH1']])
})

test('library layout of a group placed once hides the board context', async () => {
  const b = site(), store = ui.useBoard(b)
  store.pick({ kind: 'pad', id: 1, ref: 'R1', net: 'A' }, { shift: false, deep: false })
  store.chooseIsolation('library')
  assert.equal(store.iso.fade, false)
  assert.ok(store.iso.frame)
  const html = await renderToString(createSSRApp({ render: () => h(ui.PathChip, { board: b }) }))
  assert.match(text(html), /Library layout: G/)
  assert.doesNotMatch(html, /instances follow|Instance whose values are shown/)
})
