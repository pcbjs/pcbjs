// A click on a pour, in 2D or 3D, opens its pour() call: the click plan opens it and clears the selection, and the open
// request carries the whole call, not the shorter layout element around it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clickAction, clickPlan, openQuery, sourceTarget } from '../src/source.ts'

// line 10 is a pour inside a layout, line 26 the layout's element; line 39 a pour on the board, line 41 a stitch() call
const sources = {
  'blinky.pcb.tsx': [
    { start: [8, 3], end: [11, 6], ids: [4, 10], outer: [4, 10], refs: [] },
    { start: [10, 6], end: [10, 53], ids: [10], refs: [] },
    { start: [26, 5], end: [26, 28], ids: [4, 10], outer: [4, 10], refs: ['R2'] },
    { start: [39, 6], end: [39, 34], ids: [82], refs: [] },
    { start: [41, 6], end: [41, 30], ids: [90, 91], refs: [] },
  ],
}
const board = { sources, footprints: [] }
const click = clickAction('click', { metaKey: false, ctrlKey: false, shiftKey: false }, true)

test('a click on a pour opens it quietly and clears the pin and the selection', () => {
  const zone = { kind: 'zone', net: 'GND' }
  assert.deepEqual(clickPlan(zone, click), { open: 'placement', quiet: true, pin: null, select: null })
  assert.deepEqual(clickPlan(zone, clickAction('meta-click', { metaKey: true, ctrlKey: false, shiftKey: false }, true)), { open: 'placement', quiet: false })
  assert.deepEqual(clickPlan(zone, clickAction('meta-click', { metaKey: false, ctrlKey: false, shiftKey: false }, true)), { open: null, quiet: true, pin: null, select: null })
  assert.deepEqual(clickPlan(null, click), { open: null, quiet: true, pin: null, select: null })
  assert.deepEqual(clickPlan({ kind: 'pad', ref: 'R1', net: 'GND' }, click), { open: 'placement', quiet: true, pin: 'GND', select: 'R1' })
})

test('the open request of a pour carries its whole pour() call', () => {
  const q = id => Object.fromEntries(new URLSearchParams(openQuery('blinky.pcb.tsx', sourceTarget(board, { id, ref: null }))))
  assert.deepEqual(q(82), { file: 'blinky.pcb.tsx', line: '39', col: '6', endLine: '39', endCol: '34' })
  assert.deepEqual(q(10), { file: 'blinky.pcb.tsx', line: '10', col: '6', endLine: '10', endCol: '53' })
  assert.deepEqual(q(91), { file: 'blinky.pcb.tsx', line: '41', col: '6', endLine: '41', endCol: '30' })
})
