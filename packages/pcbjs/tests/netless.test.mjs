// Copper on no net: pour(null), via(null), a drawn route .net(null) and the stdlib MountingHole ring, foreign to every net.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, pour, route, via, bindRef } from '@pcbjs/core'
import { MountingHole, R0603 } from '@pcbjs/lib'
import { compileBoard } from '@pcbjs/compile'

const AREA = 'M 0 0 H 30 V 20 H 0 Z'
const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const board = (...kids) => compileBoard(h(PCB, { name: 'Netless' }, edge(), ...kids), { cache: false })
const zones = b => b.items.filter(i => i.kind === 'zone')
const rules = (b, rule) => b.drc.filter(f => f.rule === rule)

test('pour(null): fills last whatever the priority, keeps every island and stays out of the copper of every net', () => {
  const { A, GND } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R1')
  const b = board(h(R1, { at: '5 10' }), pour(null, 'F.Cu', AREA, { priority: 5 }), pour(GND, 'F.Cu', 'M 0 0 H 10 V 20 H 0 Z'))
  const [netted, free] = [zones(b).find(z => z.net === 'GND'), zones(b).find(z => z.net === undefined)]
  assert.ok(netted.fill.length && free.fill.length)
  // the netted pour fills its whole area: the pour on no net, of higher priority, did not cut it
  const area = z =>
    z.fill.reduce((s, p) => s + Math.abs(p.outer.reduce((a, q, i) => a + q[0] * p.outer[(i + 1) % p.outer.length][1] - p.outer[(i + 1) % p.outer.length][0] * q[1], 0)) / 2, 0)
  assert.ok(area(netted) > 150, `GND pour area ${area(netted)}`)
  // the pour on no net holds no pad of a net, and keeps its fill
  assert.ok(area(free) > 150, `pour on no net area ${area(free)}`)
  assert.equal(free.islandsRemoved, undefined)
  assert.deepEqual(rules(b, 'short'), [])
  assert.deepEqual(rules(b, 'clearance'), [])
  assert.equal(rules(b, 'unconnected').filter(f => f.net === undefined).length, 0, 'copper on no net is never unconnected')
})

test('pour(null): two pours on no net clear each other, the later around the earlier', () => {
  const b = board(pour(null, 'F.Cu', 'M 0 0 H 20 V 20 H 0 Z'), pour(null, 'F.Cu', 'M 10 0 H 30 V 20 H 10 Z'))
  assert.deepEqual(rules(b, 'short'), [])
  assert.deepEqual(rules(b, 'clearance'), [])
})

test('via(null) and a drawn route on no net are foreign copper: a contact is a short that says no net', () => {
  const b = board(route('3 10').net(null).width(0.3).H(12), via(null, '12 10'))
  const [s] = rules(b, 'short')
  assert.ok(s, 'the via on no net touches the track on no net')
  assert.match(s.message, /no net/)
  assert.equal(b.items.filter(i => i.kind === 'via')[0].net, undefined)
})

test('MountingHole: a part on no net until .connect({ 1: GND }), never unconnected-pin, and plated: false keeps a ring on both sides', () => {
  const { GND } = nets()
  const Hole = MountingHole(3.2, { pad: true })
  const plain = board(h(Hole({ ref: 'H1' }), { at: '8 10' }), pour(GND, 'B.Cu', AREA))
  const ring = plain.items.find(i => i.kind === 'pad' && i.ref === 'H1')
  assert.equal(ring.net, undefined)
  assert.equal(ring.type, 'tht')
  assert.deepEqual(rules(plain, 'short'), [])
  assert.equal(rules(plain, 'unconnected').length, 0)
  assert.equal(plain.erc.filter(f => f.rule === 'unconnected-pin').length, 0, 'a part never connected leaves no pin unconnected')
  const H2 = bindRef(Hole().connect({ 1: GND }), 'H2')
  const tied = board(h(H2, { at: '8 10' }), pour(GND, 'B.Cu', AREA))
  assert.equal(tied.items.find(i => i.kind === 'pad' && i.num === '1').net, 'GND')
  const bare = board(h(MountingHole(3.2, { pad: 6, plated: false })({ ref: 'H3' }), { at: '8 10' }))
  const p = bare.items.find(i => i.kind === 'pad' && i.ref === 'H3')
  assert.equal(p.type, 'npth')
  assert.deepEqual(
    p.layers.filter(l => l.endsWith('.Cu')),
    ['F.Cu', 'B.Cu'],
  )
  assert.equal(board(h(MountingHole(3.2)({ ref: 'H4' }), { at: '8 10' })).footprints[0].id, 'pcbjs:MountingHole_3.2mm_M3')
})
