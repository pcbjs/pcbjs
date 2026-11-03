// Copper on no net: a pour, a via and drawn copper given `null` as their net, foreign to every net and to each other.
import { fp, P, net } from './parts.mjs'
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, pour, resetDefaults, route, via } from '@pcbjs/core'
import { compileBoard, CompileError } from '../dist/index.js'
import { area, intersection, polysToRings } from '../dist/geom.js'

afterEach(() => resetDefaults())

const board = (...kids) => compileBoard(h(PCB, { name: 'N' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 }), ...kids), { cache: false })
const zones = b => b.items.filter(i => i.kind === 'zone')
const sq = (x, y, r = 0.02) => [
  [x - r, y - r],
  [x + r, y - r],
  [x + r, y + r],
  [x - r, y + r],
]
const covers = (z, x, y) => polysToRings(intersection(polysToRings(z.fill), [sq(x, y)])).length > 0
const pad = (ref, at, net) => fp({ ref, at, nets: { 1: net } }, h('pad', { num: 1, size: [1, 1], type: 'smd' }))
const LEFT = 'M0 0 H12 V20 H0 Z',
  ALL = 'M0 0 H20 V20 H0 Z'

test('netless pour: fills after every pour on a net whatever its priority, and clears from it', () => {
  const b = board(pour(null, 'F.Cu', ALL, { priority: 9 }), pour(net('GND'), 'F.Cu', LEFT), pad('U1', '3 3', 'GND'))
  const [free, gnd] = zones(b)
  assert.equal(free.net, undefined, 'no net is an absent net')
  assert.ok(covers(gnd, 6, 10), 'the pour on a net keeps its whole area')
  assert.ok(!covers(free, 6, 10) && !covers(free, 12.1, 10), 'the netless pour stays out of it and its clearance')
  assert.ok(covers(free, 16, 10))
})

test('netless pour: keeps every island and clears from every net', () => {
  const b = board(pour(null, 'F.Cu', ALL), route('10 -1').net(net('SIG')).width(0.5).L(10, 21), pad('U1', '4 4', 'A'))
  const [z] = zones(b)
  assert.equal(z.fill.length, 2, 'both pieces of the split stay')
  assert.equal(z.islandsRemoved, undefined)
  assert.ok(!covers(z, 4, 4) && !covers(z, 4.6, 4), 'the pad of A and its clearance are cut out')
  assert.ok(!covers(z, 10, 5), 'so is the track')
  assert.deepEqual(
    b.drc.filter(d => d.rule === 'unconnected' || d.rule === 'short' || d.rule === 'clearance'),
    [],
  )
})

test('netless pour: a later one on the same layer clears from an earlier one', () => {
  const b = board(pour(null, 'F.Cu', LEFT), pour(null, 'F.Cu', ALL))
  const [first, second] = zones(b)
  assert.ok(covers(first, 11.9, 10), 'the earlier keeps its area')
  assert.ok(!covers(second, 6, 10) && !covers(second, 12.1, 10), 'the later stays clear of it')
  assert.ok(covers(second, 16, 10))
  const overlap = area(polysToRings(intersection(polysToRings(first.fill), polysToRings(second.fill))))
  assert.equal(overlap, 0)
})

test('netless via and drawn copper: foreign to every net in DRC, findings say no net, never unconnected', () => {
  const b = board(route('2 10').net(net('A')).width(0.3).H(18), via(null, '10 10'), route('2 10.4').net(null).width(0.2).H(8), pad('U1', '1 10', 'A'), pad('U2', '19 10', 'A'))
  const short = b.drc.filter(d => d.rule === 'short')
  assert.ok(short.length >= 1)
  assert.ok(
    short.every(d => /no net/.test(d.message)),
    short.map(d => d.message).join('\n'),
  )
  const near = b.drc.filter(d => d.rule === 'clearance' || d.rule === 'short').filter(d => /track \(no net\)|\(no net\)/.test(d.message))
  assert.ok(near.length >= 2, 'the netless track is too close to A as well')
  const lone = board(via(null, '5 5'), route('12 12').net(null).width(0.2).H(15))
  assert.equal(lone.unconnected, 0)
  assert.deepEqual(
    lone.drc.filter(d => d.rule === 'unconnected'),
    [],
  )
  assert.equal(lone.items.find(i => i.kind === 'via').net, undefined)
})

test('netless route: an automatic leg is a compile error', () => {
  assert.throws(
    () => board(route('3 3', '10 3').net(null)),
    e => e instanceof CompileError && /no net/.test(e.message),
  )
  assert.throws(
    () => board(route('3 3').net(null).H(5).X('10 3')),
    e => e instanceof CompileError && /no net/.test(e.message),
  )
})
