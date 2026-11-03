// `.current()`: DRC current-width checks each declared width against the IPC-2152 baseline for the copper it runs on, branches summing toward the root.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { nets, route } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { ipc2152Width } from '@pcbjs/compile/internal/current'
import { fp, handle } from './parts.mjs'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 20 })
const pad = (ref, at, net) => fp({ ref, at, nets: { 1: net } }, h('pad', { num: 1, size: 1.5, type: 'smd' }))
const board = (...kids) => compileBoard(h(PCB, { name: 'Amps' }, edge(), ...kids), { cache: false })
const found = b => b.drc.filter(d => d.rule === 'current-width')

test('ipc2152Width: about 0.29 mm for 1 A and 1.1 mm for 2 A on 1 oz at a 10 °C rise, wider on thinner copper', () => {
  assert.ok(Math.abs(ipc2152Width(1, 0.035) - 0.286) < 0.01, String(ipc2152Width(1, 0.035)))
  assert.ok(Math.abs(ipc2152Width(2, 0.035) - 1.12) < 0.03, String(ipc2152Width(2, 0.035)))
  assert.ok(ipc2152Width(1, 0.0175) > ipc2152Width(1, 0.035))
})

test('current-width: a route too thin for its current is an error naming the width it needs; a wide enough one passes', () => {
  const N = nets()
  const thin = board(pad('J1', '5 10', N.P), pad('J2', '35 10', N.P), route(handle('J1.1'), handle('J2.1')).width(0.25).current('2A'))
  const [f] = found(thin)
  assert.equal(f.severity, 'error')
  assert.match(f.message, /^route:1 carries 2 A, which needs 1\.1\d+ mm of 1 oz copper on F\.Cu for a 10 °C rise per IPC-2152; it is 0\.25 mm wide$/)
  assert.deepEqual(f.refs, ['route:1'])
  const wide = board(pad('J1', '5 10', N.P), pad('J2', '35 10', N.P), route(handle('J1.1'), handle('J2.1')).width(1.2).current('2000mA'))
  assert.deepEqual(found(wide), [])
})

test('current-width: a trunk carries its branches, and a width after the last fork only its own current', () => {
  const N = nets()
  const b = board(
    pad('J1', '5 10', N.P),
    pad('R1', '20 4', N.P),
    pad('R2', '30 16', N.P),
    pad('R3', '35 10', N.P),
    route(handle('J1.1'), handle('R3.1'))
      .width(0.6)
      .H(20)
      .branch(x => x(handle('R1.1')).current('1A').X())
      .H(30)
      .branch(x => x(handle('R2.1')).current(1).X())
      .width(0.3)
      .X(),
  )
  const msgs = found(b).map(f => f.message)
  assert.equal(msgs.length, 1, msgs.join('\n'))
  assert.match(msgs[0], /^route:1 carries 2 A, .* it is 0\.6 mm wide$/)
})

test('.current() takes amps, and .topology() is reserved for beta3', () => {
  assert.throws(() => route('1 1', '2 2').current('two'), /takes a positive current in amps, such as 2, '2A' or '500mA'/)
  assert.throws(() => route('1 1', '2 2').topology('fly-by'), /reserved: fly-by, star and other bus topologies arrive with beta3/)
})
