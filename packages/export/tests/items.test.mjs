// The 3D items of the site data: drills cut the copper that crosses them, and `covered` is the part under the mask.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { siteItems } from '../dist/items.js'

const outline = h('path', { layer: 'Edge.Cuts', d: 'M0 0 H30 V20 H0 Z' })
const area = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2 }
const inRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c } return c }
/** Whether p is in the copper of the rings: inside more outers than holes. */
const inCopper = (p, rings) => rings.reduce((w, r) => w + (inRing(p, r) ? (area(r) > 0 ? 1 : -1) : 0), 0) > 0
/** Points on circles round c up to radius r. */
const disc = (c, r) => { const out = [c]; for (let k = 1; k <= 4; k++) for (let i = 0; i < 16; i++) { const a = (i / 16) * 2 * Math.PI; out.push([c[0] + (r * k / 4) * Math.cos(a), c[1] + (r * k / 4) * Math.sin(a)]) } return out }

test('items: a track across a via stops at its hole on both sides, and the via keeps its hole second', () => {
  const b = compileBoard(h(PCB, { name: 'Via' }, outline, h('via', { net: 'A', at: '15 10' }),
    h('track', { net: 'A', layer: 'F.Cu', width: 0.5, d: 'M10 10 H20' })))
  const items = siteItems(b)
  assert.deepEqual(items.map(i => i.id), b.items.map(i => i.id), 'one item per board item, ids kept')
  const via = b.items.find(i => i.kind === 'via'), r = via.drill / 2 - 0.005
  const track = items.find(i => i.kind === 'track')
  for (const p of disc(via.at, r)) assert.ok(!inCopper(p, track.rings), `no track copper in the drill at ${p}`)
  assert.ok(inCopper([12, 10], track.rings) && inCopper([18, 10], track.rings), 'the track is kept either side of the via')
  const v = items.find(i => i.kind === 'via')
  assert.ok(area(v.rings[0]) > 0 && area(v.rings[1]) < 0, 'the via ring, then its hole')
  for (const p of disc(via.at, r)) assert.ok(!inCopper(p, v.rings))
})

test('items: a slotted pad and the track into it are cut by the slot, and the track is finish inside the opening', () => {
  const fp = h('footprint', { ref: 'J1', value: 'V', id: 'pcbjs:Slot', at: '15 10', 'net:pad1': 'A', bom: false },
    h('pad', { num: 1, shape: 'oval', size: [3, 1.6], drill: [2.2, 0.8] }))
  const b = compileBoard(h(PCB, { name: 'Slot' }, outline, fp, h('track', { net: 'A', layer: 'F.Cu', width: 0.4, d: 'M8 10 H15' })))
  const items = siteItems(b)
  assert.deepEqual(items.map(i => i.id), b.items.map(i => i.id))
  const pad = items.find(i => i.kind === 'pad'), track = items.find(i => i.kind === 'track')
  // the slot runs along x from 14.3 to 15.7 at y 10, 0.8 wide
  const inSlot = [[15, 10], [14.4, 10], [15.6, 10], [15, 10.35], [14.6, 9.7]]
  for (const p of inSlot) {
    assert.ok(!inCopper(p, pad.rings), `no pad copper in the slot at ${p}`)
    assert.ok(!inCopper(p, track.rings), `no track copper in the slot at ${p}`)
  }
  assert.ok(inCopper([13.8, 10], pad.rings) && inCopper([13.8, 10], track.rings), 'pad and track meet beside the slot')
  // the pad is all exposed, the track only up to its opening
  assert.deepEqual(pad.covered, { F: [], B: [] })
  const cov = track.covered.F
  assert.ok(inCopper([10, 10], cov) && !inCopper([13.8, 10], cov), 'the track is under the mask out of the opening only')
  assert.equal(track.covered.B, undefined)
})

test('items: a turned slot drill is a stadium of its width and length in the pad, the board drills and the drill file alike', async () => {
  const { siteData } = await import('../dist/site-data.js')
  const { excellon } = await import('../dist/excellon.js')
  const fp = h('footprint', { ref: 'J1', value: 'V', id: 'pcbjs:Slot', at: '15 10 30', 'net:pad1': 'A', 'net:pad2': 'A', bom: false },
    h('pad', { num: 1, shape: 'oval', size: [3, 1.6], drill: [2.2, 0.8] }), h('pad', { num: 2, shape: 'circle', size: [1.6, 1.6], drill: 0.8, at: '0 4' }))
  const b = compileBoard(h(PCB, { name: 'Slot' }, outline, fp))
  const site = siteData(b, { root: '/', dev: false, fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', bom: [] })
  const slot = site.drills.find(d => d.len !== undefined), round = site.drills.find(d => d.len === undefined)
  assert.deepEqual({ x: slot.x, y: slot.y, d: slot.d, len: slot.len, a: slot.a }, { x: 15, y: 10, d: 0.8, len: 2.2, a: 150 })
  assert.equal(round.d, 0.8, 'a round drill keeps its diameter alone')
  const ends = excellon(b, true, 'today').tools[0].holes.find(h => h.end)
  const ax = [Math.cos(slot.a * Math.PI / 180), Math.sin(slot.a * Math.PI / 180)]
  const along = (ends.end[0] - ends.x) * ax[0] + (ends.end[1] - ends.y) * ax[1]
  assert.ok(Math.abs(Math.abs(along) - (slot.len - slot.d)) < 1e-6, 'the drill file routes along the same axis, between the end centres')
  const slotted = b.items.find(i => i.kind === 'pad' && i.drill[0] !== i.drill[1]), pad = siteItems(b).find(i => i.id === slotted.id)
  const hole = pad.rings[1], c = [15, 10]
  const proj = (p, v) => (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1]
  const span = v => Math.max(...hole.map(p => proj(p, v))) - Math.min(...hole.map(p => proj(p, v)))
  assert.ok(Math.abs(span(ax) - 2.2) < 0.01, `the cut is 2.2 long, not ${span(ax)}`)
  assert.ok(Math.abs(span([-ax[1], ax[0]]) - 0.8) < 0.01, `the cut is 0.8 wide, not ${span([-ax[1], ax[0]])}`)
  // a stadium: every point 0.4 from the segment between the end centres
  const half = (slot.len - slot.d) / 2
  for (const p of hole) {
    const t = Math.max(-half, Math.min(half, proj(p, ax))), q = [c[0] + t * ax[0], c[1] + t * ax[1]]
    assert.ok(Math.abs(Math.hypot(p[0] - q[0], p[1] - q[1]) - 0.4) < 0.01, `${p} lies on the stadium`)
  }
  assert.ok(area(hole) < 0, 'the slot is a hole of the pad')
})
