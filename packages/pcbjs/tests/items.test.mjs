import { test } from 'node:test'
import assert from 'node:assert/strict'
import { siteData } from '@pcbjs/export/site-data'
import { compileBoard, h, PCB, PinHeader, outline } from './fixtures.mjs'

const site = board => siteData(board, { root: '/', fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', dev: false, bom: [] })

const fourLayer = () => compileBoard(h(PCB, { name: 'Items', copper: 4 },
  outline(),
  h(PinHeader, { ref: 'J1', pins: 2, at: '2 2', 'net:1': 'A', 'net:2': 'B' }),
  h(PinHeader, { ref: 'J2', pins: 2, at: '7 2', 'net:1': 'A', 'net:2': 'B' }),
  h('track', { net: 'A', layer: 'F.Cu', width: 0.3, d: 'M2 2 L7 2' }),
  h('via', { net: 'B', at: '5 6' }),
  h('text', { layer: 'F.SilkS', at: '5 8', size: 1 }, 'HI'),
  h('rect', { layer: 'F.SilkS', x: 1, y: 7, w: 2, h: 2 }),
  h('zone', { net: 'B', layer: 'B.Cu', d: 'M0 5 H10 V10 H0 Z' }),
))

test('items: every item id in the layer SVG has an entry with at least one ring', () => {
  const s = site(fourLayer())
  const byId = new Map(s.items.map(i => [i.id, i]))
  const ids = new Set(s.layers.flatMap(l => [...l.svg.matchAll(/data-id="(\d+)"/g)].map(m => +m[1])))
  assert.ok(ids.size > 0)
  assert.ok(s.items.some(i => i.kind === 'zone' && ids.has(i.id)), 'the zone fill is in the layer SVG')
  for (const id of ids) {
    const it = byId.get(id)
    assert.ok(it, `item ${id} has no entry`)
    assert.ok(it.rings.length >= 1 && it.rings.every(r => r.length >= 3), `item ${id} has no ring`)
    assert.ok(it.layers.length >= 1, `item ${id} lists no layer`)
  }
})

test('items: THT pads and through vias list every copper layer and carry their drill as a hole ring', () => {
  const s = site(fourLayer())
  const pads = s.items.filter(i => i.kind === 'pad' && i.ref === 'J1')
  assert.equal(pads.length, 2)
  for (const p of pads) {
    for (const l of ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']) assert.ok(p.layers.includes(l), `${p.id} misses ${l}`)
    assert.ok(p.drill > 0)
    assert.equal(p.rings.length, 2, 'the pad shape and its hole')
  }
  const via = s.items.find(i => i.kind === 'via')
  assert.deepEqual(via.layers, ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'])
  assert.equal(via.net, 'B')
  assert.equal(pads[0].net, 'A')
})

test('items: text is its stroked outline, outers positive and holes negative', () => {
  const s = site(fourLayer())
  const text = s.items.find(i => i.kind === 'text')
  assert.ok(text && text.rings.length >= 2, 'H and I give at least two outlines')
  assert.deepEqual(text.layers, ['F.SilkS'])
  const area = r => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0) / 2
  assert.ok(text.rings.some(r => area(r) > 0))
  const rect = s.items.find(i => i.kind === 'graphic' && i.layers[0] === 'F.SilkS')
  assert.ok(rect.rings.some(r => area(r) < 0), 'a stroked rectangle has a hole')
  const track = s.items.find(i => i.kind === 'track')
  assert.deepEqual(track.layers, ['F.Cu'])
  for (const r of track.rings) for (const [x, y] of r) assert.equal(Math.round(x * 1e3) / 1e3, x, 'rounded to 1 µm')
})
