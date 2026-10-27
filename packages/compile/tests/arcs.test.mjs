// Arcs kept beside the flattened rings: parsing `A`, the transforms of groups, and the items flatten makes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { applyPrims, arcLines, arcSweep, parsePath, pathCommands } from '../dist/path.js'
import { near, nearPt } from './helpers.mjs'

test('arcs: a circular A command is one arc primitive, clockwise for sweep flag 1', () => {
  const [sp] = parsePath('M0 0 L2 0 A1 1 0 0 1 4 0')
  assert.equal(sp.prims.length, 2)
  assert.deepEqual(sp.prims[0], { kind: 'line', from: [0, 0], to: [2, 0] })
  const a = sp.prims[1]
  assert.equal(a.kind, 'arc')
  assert.deepEqual([a.from, a.to], [[2, 0], [4, 0]])
  nearPt(a.center, [3, 0])
  assert.equal(a.cw, true)
  // the flattened ring still holds the chords, and its middle point is on the y < 0 side: upward on screen, clockwise
  assert.ok(sp.pts.length > 4)
  assert.ok(sp.pts.some(p => p[1] < -0.9))
  near(arcSweep(a), Math.PI, 1e-9)
  assert.equal(parsePath('M2 0 A1 1 0 0 0 4 0')[0].prims[0].cw, false)
})

test('arcs: Z closes with a line primitive, curves and elliptical arcs become their chords', () => {
  const [sq] = parsePath('M0 0 H2 V2 Z')
  assert.deepEqual(sq.prims.map(p => p.kind), ['line', 'line', 'line'])
  assert.deepEqual(sq.prims[2], { kind: 'line', from: [2, 2], to: [0, 0] })
  const [el] = parsePath('M0 0 A2 1 0 0 1 4 0')
  assert.ok(el.prims.length > 2 && el.prims.every(p => p.kind === 'line'))
  const [cu] = parsePath('M0 0 C1 1 2 1 3 0')
  assert.ok(cu.prims.every(p => p.kind === 'line'))
  assert.deepEqual(cu.prims.at(-1).to, [3, 0])
  // the radius grows when too small, as SVG does: a half circle
  const [big] = parsePath('M0 0 A0.5 0.5 0 0 1 4 0')
  nearPt(big.prims[0].center, [2, 0])
})

test('arcs: pathCommands carries the primitives of each command', () => {
  const cmds = pathCommands('M0 0 H5 A2 2 0 0 0 7 2')
  assert.deepEqual(cmds.map(c => c.prims.map(p => p.kind)), [['line'], ['arc']])
  nearPt(cmds[1].prims[0].center, [7, 0])
  assert.equal(cmds[1].prims[0].cw, false)
})

test('arcs: rotation keeps the direction, a mirror flips it, a non uniform scale falls back to lines', () => {
  const [sp] = parsePath('M2 0 A1 1 0 0 1 4 0')
  const rot = [0, -1, 1, 0, 10, 0] // 90 degrees, translated
  const [r] = applyPrims(rot, sp.prims)
  assert.equal(r.kind, 'arc')
  assert.equal(r.cw, true)
  nearPt(r.from, [10, -2]); nearPt(r.to, [10, -4]); nearPt(r.center, [10, -3])
  const [m] = applyPrims([-1, 0, 0, 1, 0, 0], sp.prims)
  assert.equal(m.cw, false)
  nearPt(m.center, [-3, 0])
  const [s2] = applyPrims([2, 0, 0, 2, 0, 0], sp.prims)
  assert.equal(s2.kind, 'arc')
  nearPt(s2.center, [6, 0])
  const scaled = applyPrims([2, 0, 0, 1, 0, 0], sp.prims)
  assert.ok(scaled.length > 2 && scaled.every(p => p.kind === 'line'))
  nearPt(scaled[0].from, [4, 0]); nearPt(scaled.at(-1).to, [8, 0])
  assert.equal(arcLines(sp.prims[0]).length, scaled.length)
})

test('arcs: flatten keeps prims on graphics, tracks and zones in board mm, mirrored on the back', () => {
  const b = compileBoard(h(PCB, { name: 'Arcs' },
    h('path', { layer: 'Edge.Cuts', d: 'M 2 0 H 28 A 2 2 0 0 1 30 2 V 18 H 0 V 2 A 2 2 0 0 1 2 0 Z' }),
    h('g', { at: '10 10', side: 'B' }, h('path', { layer: 'F.SilkS', d: 'M 0 0 A 1 1 0 0 1 2 0' })),
    h('circle', { layer: 'F.SilkS', cx: 5, cy: 5, r: 1 }),
    h('rect', { layer: 'F.SilkS', x: 1, y: 1, w: 4, h: 2, rx: 0.5 }),
    h('line', { layer: 'F.SilkS', x1: 0, y1: 0, x2: 1, y2: 1 }),
    h('track', { layer: 'F.Cu', width: 0.2, d: 'M 5 5 H 8 A 1 1 0 0 1 9 6' }),
    h('zone', { layer: 'F.Cu', d: 'M 20 5 H 24 A 1 1 0 0 1 24 7 H 20 Z' })))
  const gs = b.items.filter(it => it.kind === 'graphic')
  const edge = gs.find(g => g.layer === 'Edge.Cuts')
  assert.equal(edge.prims.length, 1)
  assert.deepEqual(edge.prims[0].map(p => p.kind), ['line', 'arc', 'line', 'line', 'line', 'arc'])
  const back = gs.find(g => g.layer === 'B.SilkS')
  assert.equal(back.prims[0][0].cw, false)
  nearPt(back.prims[0][0].center, [9, 10])
  const circle = gs.find(g => g.layer === 'F.SilkS' && g.prims?.[0].length === 2)
  nearPt(circle.prims[0][0].from, circle.paths[0][0])
  const rect = gs.find(g => g.layer === 'F.SilkS' && g.prims?.[0].length === 8)
  nearPt(rect.prims[0][0].from, rect.paths[0][0])
  assert.equal(gs.find(g => g.paths[0].length === 2 && g.layer === 'F.SilkS').prims, undefined)
  const tracks = b.items.filter(it => it.kind === 'track')
  assert.equal(tracks[0].prims, undefined)
  assert.equal(tracks[1].prims[0].kind, 'arc')
  const zone = b.items.find(it => it.kind === 'zone')
  assert.deepEqual(zone.prims[0].map(p => p.kind), ['line', 'arc', 'line', 'line'])
})
