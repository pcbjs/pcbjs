// One spelling for a pad everywhere: every kind of message that names one, a DRC and an ERC finding, a route and a compile error, says `R1/2` as refs do, never `R1.2`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, bindRef, route } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { baseBoard, outline } from './fixtures.mjs'
import { handle, netOf } from './parts.mjs'

const dotted = /\b[A-Z]+\d+\.\d+\b/

test('a DRC finding names its pads as R1/2: unconnected and clearance', () => {
  // net B is left unrouted, and a track of B runs 0.1 mm from J1's pad 1 of net A
  const b = compileBoard(baseBoard([route('1 3.1').net(netOf('B')).width(0.3).H(3.5)]))
  const unconnected = b.drc.filter(d => d.rule === 'unconnected').map(d => d.message)
  assert.ok(unconnected.includes('net B is not fully connected, from J2/2 at (7.00, 4.54) to J1/2 at (2.00, 4.54)'), unconnected.join('\n'))
  const clearance = b.drc.find(d => d.rule === 'clearance')
  assert.match(clearance.message, /pad J1\/1 \(A\)/)
  for (const d of b.drc) assert.doesNotMatch(d.message, dotted, d.message)
})

test('an ERC finding names its pin as J1/3', () => {
  const { A, B } = nets()
  const J1 = bindRef(PinHeader(3)().connect({ 1: A, 2: B }), 'J1', { file: 'sch.ts', line: 1, col: 7 })
  const b = compileBoard(h(PCB, { name: 'E' }, outline(), h(J1, { at: '5 5' })))
  const open = b.erc.find(f => f.rule === 'unconnected-pin')
  assert.match(open.message, /^J1\/3, /)
  assert.deepEqual(open.refs, ['J1/3'])
})

test('a route that names a pad, and a compile error, name it as J1/1', () => {
  assert.throws(
    () => compileBoard(baseBoard([route(handle('J1.1'), '5 8').net(netOf('B'))])),
    e => e instanceof CompileError && /given the net B, but J1\/1 is on A/.test(e.message),
  )
  assert.throws(
    () => compileBoard(baseBoard([route(handle('J1.1'), handle('J1.1'))])),
    e => e instanceof CompileError && /J1\/1 is both ends/.test(e.message),
  )
})
