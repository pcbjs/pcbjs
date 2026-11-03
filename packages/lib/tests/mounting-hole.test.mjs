// MountingHole(drill, { pad, plated }): a bare hole, or a copper ring on no net until the part connects it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, pour, defineFootprint } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { MountingHole } from '../dist/index.js'

const board = (...kids) => compileBoard(h(PCB, { name: 'H' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 }), ...kids), { cache: false })
const pads = b => b.items.filter(i => i.kind === 'pad')
const hole = (opts, at = '5 5') => h(MountingHole(3.2, opts)({ ref: 'H1' }), { at })
const Pad = defineFootprint(
  function Pad(props) {
    return h('footprint', props, h('pad', { num: 1, size: 1, type: 'smd' }))
  },
  { pins: ['1'], prefix: 'U' },
)

test('MountingHole: a bare hole has no copper, a ring is plated and on no net, never unconnected', () => {
  const [bare] = pads(board(hole()))
  assert.equal(bare.type, 'npth')
  assert.deepEqual(
    bare.layers.filter(l => l.endsWith('.Cu')),
    [],
  )
  const { GND } = nets()
  const b = board(hole({ pad: true }), pour(GND, 'F.Cu', 'M0 0 H20 V20 H0 Z'), h(Pad({ ref: 'U1' }).connect({ 1: GND }), { at: '15 15' }))
  const [ring] = pads(b)
  assert.equal(ring.type, 'tht')
  assert.equal(ring.net, undefined)
  assert.deepEqual(
    b.drc.filter(d => d.severity === 'error'),
    [],
    'the GND pour clears the ring as foreign copper',
  )
})

test('MountingHole: plated false keeps the ring on both outer layers of an unplated hole, connect ties a plated ring to a net', () => {
  const [ring] = pads(board(hole({ pad: 6, plated: false })))
  assert.equal(ring.type, 'npth')
  assert.deepEqual(
    ring.layers.filter(l => l.endsWith('.Cu')),
    ['F.Cu', 'B.Cu'],
  )
  const { GND } = nets()
  const H1 = MountingHole(3.2, { pad: true })({ ref: 'H1' }).connect({ 1: GND })
  assert.equal(pads(board(h(H1, { at: '5 5' })))[0].net, 'GND')
})

test('MountingHole: options are checked', () => {
  assert.throws(() => MountingHole(3.2, true), /options must be an object/)
  assert.throws(() => MountingHole(3.2, { ring: 6 }), /unknown option "ring"/)
  assert.throws(() => MountingHole(3.2, { plated: true }), /plated hole needs its copper ring/)
  assert.throws(() => MountingHole(3.2, { pad: 3.4 }), /less than a 0.2 mm ring/)
})
