// The layers facet's rows hold no geometry and name each pad; the shapes facet holds every item's rings by id, and each side's mask
// openings as the mask layer's markup draws them, so no reader parses markup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, route } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { allRings, ringsIn } from '@pcbjs/core/site-shapes'
import { layersFacet, shapesFacet, siteItems } from '../dist/site-data.js'
import { layerMarkup } from '../dist/svg.js'
import { fp, N } from './parts.mjs'

const outline = h('path', { layer: 'Edge.Cuts', d: 'M0 0 H30 V20 H0 Z' })

/** The rings of the filled paths of a layer's markup, by the path's item id. */
function markupRings(svg) {
  const out = []
  for (const m of svg.matchAll(/<path\b([^>]*)>/g)) {
    if (/fill="none"/.test(m[1])) continue
    const id = +/data-id="(\d+)"/.exec(m[1])[1]
    const rings = /\bd="([^"]*)"/
      .exec(m[1])[1]
      .split('Z')
      .map(sub =>
        sub
          .replace(/[ML]/g, ' ')
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
      )
      .filter(n => n.length >= 6)
      .map(n => n.flatMap((v, i) => (i % 2 ? [] : [[v, n[i + 1]]])))
    if (rings.length) out.push([id, rings])
  }
  return out
}

test('shapes: rows without geometry, every ring by id, and the mask openings as the mask markup draws them', () => {
  const R1 = fp(
    { ref: 'R1', value: 'R', id: 'pcbjs:R', at: '10 10', 'net:pad1': 'A', 'net:pad2': 'B' },
    h('pad', { num: 1, shape: 'rect', size: [1, 1.2], at: '-1 0' }),
    h('pad', { num: 2, shape: 'roundrect', size: [1, 1.2], at: '1 0' }),
  )
  const b = compileBoard(h(PCB, { name: 'S' }, outline, R1, route('9 10').net(N.A).width(0.3).H(4)))
  const items = siteItems(b)
  const rows = layersFacet(b, '/', items).items
  assert.ok(rows.every(r => !('rings' in r) && !('covered' in r)))
  assert.deepEqual(
    rows.filter(r => r.kind === 'pad').map(r => r.pad),
    ['1', '2'],
  )
  const { shapes } = shapesFacet(b, items)
  for (const it of items) assert.deepEqual(ringsIn(shapes.rings, it.row.id), it.rings)
  for (const side of ['F', 'B']) {
    const want = markupRings(layerMarkup(b, `${side}.Mask`))
    assert.deepEqual(
      shapes.openings[side].ids,
      want.map(w => w[0]),
    )
    assert.deepEqual(
      allRings(shapes.openings[side]),
      want.flatMap(w => w[1]),
    )
  }
  assert.equal(shapes.openings.F.ids.length, 2)
})
