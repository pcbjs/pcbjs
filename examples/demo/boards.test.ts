// Design intent the demo boards keep, run by `pcbjs test` against the snapshot it writes; see docs/testing.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { board } from '@pcbjs/cli/test'

test('Blinky: clean, and its LEDs all on the front', () => {
  const b = board('Blinky')
  assert.deepEqual(b.findings(), [])
  for (const d of b.parts({ prefix: 'D' })) assert.equal(d.side, 'F', d.ref)
})

test('Blinky: the decoupling capacitor sits within 9 mm of the transistor', () => {
  const b = board('Blinky')
  assert.ok(b.distance('C1', 'Q1').d <= 9)
})

test('Coin: both test points on the one net VBAT', () => {
  const b = board('Coin')
  assert.deepEqual(b.net('VBAT')?.pads, ['TP1/1', 'TP2/1'])
})

test('Quad: every route is routed', () => {
  const b = board('Quad')
  for (const r of b.routes()) assert.equal(r.status, 'ok', r.ref)
})

test('Multi: R1 joins the two test points', () => {
  const b = board('Multi')
  const nets = (ref: string) => b.part(ref)!.pads.map(p => p.net)
  assert.deepEqual(nets('R1').sort(), [...nets('TP1'), ...nets('TP2')].sort())
})
