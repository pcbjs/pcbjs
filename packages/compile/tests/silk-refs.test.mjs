// Silk refs: the candidate order around the courtyard, the label's rotation and size, rows that share a side, the silk-ref-hidden info and determinism.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { bbox } from '../dist/geom.js'
import { refRotation, refSize, SIDES } from '../dist/silk-refs.js'

afterEach(() => resetDefaults())

const opts = { routeCache: false }
const edge = (w = 40, hh = 30) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
// a two pad part with a courtyard of w by hh mm round its origin
const part = (ref, at, { w = 1.8, hh = 0.9, id = 'test:R', ...props } = {}) => h('footprint', { ref, at, id, ...props },
  h('pad', { num: 1, at: `${-w / 4} 0`, size: [w / 4, hh / 2] }), h('pad', { num: 2, at: `${w / 4} 0`, size: [w / 4, hh / 2] }),
  h('rect', { layer: 'F.CrtYd', x: -w / 2, y: -hh / 2, w, h: hh, width: 0.05 }))
const board = (props, ...kids) => compileBoard(h(PCB, { name: 'Silk', ...props }, edge(), ...kids), opts)
const label = (b, ref) => b.items.find(i => i.kind === 'text' && i.ref === ref && i.text === ref)
const ink = t => { const b = bbox(t.strokes), d = t.thickness / 2; return { x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d } }
const cx = b => b.x + b.w / 2, cy = b => b.y + b.h / 2
const block = (x, y) => h('text', { layer: 'F.SilkS', at: `${x} ${y}`, size: 1 }, 'XXXX')
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol

test('candidates: above, below, left, right, then the corners flush and off them', () => {
  assert.deepEqual(SIDES.map(([u, v, f]) => `${u},${v}${f ? 'f' : ''}`), ['0,1', '0,-1', '-1,0', '1,0', '-1,1f', '1,1f', '-1,-1f', '1,-1f', '-1,1', '1,1', '-1,-1', '1,-1'])
  const above = ink(label(board({}, part('R1', '20 15')), 'R1'))
  assert.ok(above.y + above.h <= 15 - 0.45 && near(cx(above), 20), 'above and centred')
  const below = ink(label(board({}, part('R1', '20 15'), block(20, 13)), 'R1'))
  assert.ok(below.y >= 15 + 0.45 && near(cx(below), 20), 'below when a text is above')
  const left = ink(label(board({}, part('R1', '20 15'), block(20, 13), block(20, 17)), 'R1'))
  assert.ok(left.x + left.w <= 20 - 0.9 && near(cy(left), 15), 'left when above and below are taken')
  const right = ink(label(board({}, part('R1', '20 15'), block(20, 13), block(20, 17), block(16, 15)), 'R1'))
  assert.ok(right.x >= 20 + 0.9 && near(cy(right), 15), 'right after left')
})

test('orientation: a quarter turn reads bottom to top, any other angle left to right, the back is mirrored', () => {
  assert.deepEqual([0, 90, 180, 270, -90, 45, 135, 450].map(refRotation), [0, 90, 0, 90, 90, 0, 0, 90])
  const b = board({}, part('R1', '10 10 90deg'), part('R2', '20 10 270deg'), part('R3', '30 10 180deg'), part('R4', '10 20 30deg'), part('R5', '20 20', { side: 'B' }))
  assert.deepEqual(['R1', 'R2', 'R3', 'R4', 'R5'].map(r => label(b, r).rot), [90, 90, 0, 0, 0])
  assert.equal(label(b, 'R5').mirrored, true)
  assert.equal(label(b, 'R5').layer, 'B.SilkS')
  // a turned part's label sits beside it, reading upwards
  const t = ink(label(b, 'R1'))
  assert.ok(t.h > t.w && t.x + t.w <= 10 - 0.45, 'left of the turned part')
})

test('size: scales with the courtyard between the fab floor and the ceiling', () => {
  assert.equal(refSize({ x: 0, y: 0, w: 1.8, h: 0.9 }, 1), 1)
  assert.equal(refSize({ x: 0, y: 0, w: 1.8, h: 0.9 }, 0.8), 0.8)
  assert.equal(refSize({ x: 0, y: 0, w: 5.5, h: 5.5 }, 0.8), 1.1)
  assert.equal(refSize({ x: 0, y: 0, w: 20, h: 20 }, 1), 1.2)
  const b = board({ rules: { silkMinHeight: 0.8 } }, part('R1', '10 10'), part('U1', '25 15', { w: 10, hh: 10, id: 'test:U' }))
  assert.equal(label(b, 'R1').size, 0.8)
  assert.equal(label(b, 'R1').thickness, 0.15)
  assert.equal(label(b, 'U1').size, 1.2)
  assert.equal(label(b, 'U1').thickness, 0.18)
  assert.equal(board({}, part('R1', '10 10')).items.find(i => i.kind === 'text').size, 1, 'BASE floor 1 mm')
})

test('rows: identical parts in a line take the same side, aligned, even when one alone would go elsewhere', () => {
  const caps = [0, 1, 2, 3].map(i => part(`C${i + 1}`, `${10 + 3 * i} 15`, { id: 'test:C' }))
  // a text above C2 alone: one by one C2 would go below, the row goes below together
  const b = board({}, ...caps, block(13, 13))
  const boxes = ['C1', 'C2', 'C3', 'C4'].map(r => ink(label(b, r)))
  for (const t of boxes) assert.ok(t.y >= 15.45, 'below')
  assert.ok(boxes.every(t => near(cy(t), cy(boxes[0]))), 'aligned')
  const free = board({}, ...caps)
  assert.ok(['C1', 'C2', 'C3', 'C4'].every(r => ink(label(free, r)).y + ink(label(free, r)).h <= 14.55), 'above with nothing in the way')
})

test('hidden: a part too small to hold its label with no spot round it is left out with one silk-ref-hidden info', () => {
  const b = compileBoard(h(PCB, { name: 'Tiny' }, edge(3, 2), part('R1', '1.5 1')), opts)
  assert.equal(label(b, 'R1'), undefined)
  const f = [...b.drc, ...b.erc].filter(d => /silk-ref/.test(d.rule))
  assert.equal(f.length, 1)
  assert.equal(f[0].rule, 'silk-ref-hidden')
  assert.equal(f[0].severity, 'info')
  assert.match(f[0].message, /of R1, too small to hold its ref/)
})

test('a part large enough takes a pad-free spot inside its courtyard when nothing round it is free', () => {
  const big = h('footprint', { ref: 'U1', at: '3 3', id: 'test:U' },
    h('pad', { num: 1, at: '-2 0', size: [0.6, 4] }), h('pad', { num: 2, at: '2 0', size: [0.6, 4] }),
    h('rect', { layer: 'F.CrtYd', x: -2.5, y: -2.5, w: 5, h: 5, width: 0.05 }))
  const b = compileBoard(h(PCB, { name: 'Snug' }, edge(6, 6), big), opts)
  const t = ink(label(b, 'U1'))
  assert.ok(t.x >= 0.5 && t.x + t.w <= 5.5 && t.y >= 0.5 && t.y + t.h <= 5.5, 'inside the courtyard')
  assert.deepEqual([...b.drc, ...b.erc].filter(d => /silk/.test(d.rule)), [])
})

test('determinism: the same board gives the same labels', () => {
  const make = () => board({}, ...[0, 1, 2, 3, 4].map(i => part(`R${i + 1}`, `${10 + 2.2 * i} ${15 + (i % 2)}`)), part('U1', '20 22', { w: 6, hh: 4, id: 'test:U' }))
  const texts = b => b.items.filter(i => i.kind === 'text').map(t => [t.ref, t.at, t.rot, t.size])
  assert.deepEqual(texts(make()), texts(make()))
})
