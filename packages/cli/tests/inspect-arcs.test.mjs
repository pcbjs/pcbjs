// inspect --json: a track or drawing that holds an arc lists its lines and arcs as the model keeps them, centre and direction
// included, beside the flattened points, so a check needs no circle fit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { inspectBoard } from '../dist/inspect.js'

const pad = (ref, x, y, net) => h('footprint', { ref, value: 'V', id: 'pcbjs:TestPad', at: `${x}mm ${y}mm`, 'net:pad1': net, bom: false },
  h('pad', { num: 1, size: 1, shape: 'circle', drill: 0.5 }),
  h('path', { layer: 'F.SilkS', d: 'M -1 -1.5 A 1.5 1.5 0 0 1 1 -1.5', width: 0.15 }))
const board = () => compileBoard(h(PCB, { name: 'Arcs' },
  h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 30 V 20 H 0 Z' }),
  pad('TP1', 5, 10, 'A'), pad('TP2', 15, 10, 'A'), pad('TP3', 25, 10, 'B'),
  // a half circle of radius 5 about (10, 10), clockwise on screen from TP1 over the top to TP2
  h('track', { layer: 'F.Cu', width: 0.3, net: 'A', d: 'M 5 10 A 5 5 0 0 1 15 10' }),
  h('path', { layer: 'F.Cu', width: 0.3, net: 'B', d: 'M 25 10 L 25 14 A 2 2 0 0 0 27 16' })))

test('inspect --json: an arc track carries prims with from, to, centre and cw beside its points', () => {
  const r = inspectBoard(board(), 'pcb.tsx', '/', 'A')
  const t = r.json.tracks[0]
  assert.ok(t.pts.length > 2, 'the flattened points stay')
  assert.equal(t.prims.length, 1)
  const [a] = t.prims
  assert.equal(a.kind, 'arc')
  assert.deepEqual(a.from, [5, 10])
  assert.deepEqual(a.to, [15, 10])
  assert.deepEqual(a.center, [10, 10])
  assert.equal(a.cw, true)
  assert.ok(Math.abs(t.length - Math.PI * 5) < 0.01)
})

test('inspect --json: a copper drawing of the net and a part\'s drawings carry their lines and arcs', () => {
  const b = board()
  const g = inspectBoard(b, 'pcb.tsx', '/', 'B').json.graphics
  assert.equal(g.length, 1)
  assert.deepEqual(g[0].prims[0].map(q => q.kind), ['line', 'arc'])
  assert.deepEqual(g[0].prims[0][1], { kind: 'arc', from: [25, 14], to: [27, 16], center: [27, 14], cw: false })
  const part = inspectBoard(b, 'pcb.tsx', '/', 'TP1').json.footprint
  const silk = part.graphics.find(x => x.layer === 'F.SilkS')
  assert.equal(silk.prims[0][0].kind, 'arc')
  assert.deepEqual(silk.prims[0][0].from, [4, 8.5])
})

test('inspect --json: a straight track has no prims', () => {
  const b = compileBoard(h(PCB, { name: 'Straight' }, h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 30 V 20 H 0 Z' }), pad('TP1', 5, 10, 'A'), pad('TP2', 15, 10, 'A'),
    h('track', { layer: 'F.Cu', width: 0.3, net: 'A', d: 'M 5 10 L 15 10' })))
  assert.equal(inspectBoard(b, 'pcb.tsx', '/', 'A').json.tracks[0].prims, undefined)
})
