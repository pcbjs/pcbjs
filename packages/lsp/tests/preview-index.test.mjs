import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pack } from '@pcbjs/core/site-shapes'
import { renderPreview } from '../dist/preview.js'

test('a cropped hover leaves off-screen geometry packed', () => {
  const square = x => [
    [x, 0],
    [x + 1, 0],
    [x + 1, 1],
    [x, 1],
  ]
  const rings = pack([
    [1, [square(0)]],
    [2, [square(100)]],
  ])
  let farReads = 0
  rings.xy = new Proxy(rings.xy, {
    get: (a, key) => {
      if (typeof key === 'string' && /^\d+$/.test(key) && Number(key) >= 8) farReads++
      return Reflect.get(a, key)
    },
  })
  const site = {
    items: [0, 100].map((x, i) => ({ id: i + 1, kind: 'pad', ref: i ? 'R2' : 'R1', layers: ['F.Cu'], box: [x, 0, x + 1, 1] })),
    footprints: [0, 100].map((x, i) => ({ ref: i ? 'R2' : 'R1', bbox: { x, y: 0, w: 1, h: 1 }, side: 'F' })),
    layers: [{ id: 'F.Cu', kind: 'copper', color: '#f00', order: 0 }],
    outline: [],
    drills: [],
    shapes: { rings },
  }
  assert.ok(renderPreview(site, { refs: ['R1'] }))
  assert.equal(farReads, 0)
  assert.ok(renderPreview(site, { refs: ['R2'] }))
  assert.ok(farReads > 0)
})
