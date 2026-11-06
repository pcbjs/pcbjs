// Cancellation refuses partial results and leaves the checked copper unchanged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, pour } from '@pcbjs/core'
import { edgeChecks } from '../dist/drc.js'
import { pulsed } from '../dist/cancel.js'
import { compileStages, CancelledError } from '../dist/index.js'
import { fp, P, N } from './parts.mjs'

const W = 40,
  H = 30
const smd = (ref, x, y, net) => fp({ ref, at: `${x} ${y}`, nets: { 1: net } }, h('pad', { num: 1, size: 1, type: 'smd' }))
/** Crossing routes and a ground pour. */
function board() {
  const parts = [],
    legs = []
  for (let i = 0; i < 12; i++) {
    const net = `S${i}`
    parts.push(smd(`A${i}`, 3, 3 + i * 2, net), smd(`B${i}`, W - 3, H - 3 - i * 2, net))
    legs.push(route(P(`A${i}.1`), P(`B${i}.1`)).width(0.2))
  }
  return h(PCB, { name: 'Cancel' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: W, h: H }), ...parts, ...legs, pour(N.GND, 'B.Cu', `M0 0 H${W} V${H} H0 Z`))
}

test('cancel: a compile refuses to return a board after cancellation', () => {
  let aborted = false
  assert.throws(
    () =>
      compileStages(board(), {
        cache: false,
        signal: {
          get aborted() {
            return aborted
          },
        },
        stage: e => {
          if (e.name === 'autoroute' && e.state === 'running') aborted = true
        },
      }),
    CancelledError,
  )
  assert.equal(aborted, true, 'the compile reached routing before cancellation')
})

test('cancel: edge clearance reads the signal between copper items without changing findings', () => {
  const tracks = Array.from({ length: 12 }, (_, i) =>
    route(`0.1 ${2 + i}`)
      .net(N[`EDGE${i}`])
      .width(0.4)
      .H(1),
  )
  const b = compileStages(h(PCB, { name: 'EdgeCancel' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 }), ...tracks), { cache: false })[0].board
  const expected = edgeChecks(b)
  const before = JSON.stringify(b)
  assert.equal(expected.length, 12, 'each track violates the same edge rule')
  let reads = 0
  assert.throws(
    () =>
      pulsed(
        () => {
          if (++reads === 7) throw new CancelledError()
        },
        () => edgeChecks(b),
      ),
    CancelledError,
  )
  assert.equal(JSON.stringify(b), before, 'cancelled checks leave the board unchanged')
  assert.deepEqual(
    pulsed(
      () => {},
      () => edgeChecks(b),
    ),
    expected,
  )
})
