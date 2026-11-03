// A click on a pour, in 2D or 3D, selects its plane, and Open placement asks for its whole pour() call, not the shorter
// layout element around it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { openQuery, sourceTarget } from '../src/source.ts'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { click, emptySelection } = await import('../src/selection.ts')

// line 10 is a pour inside a layout, line 26 the layout's element; line 39 a pour on the board, line 41 a stitch() call
const sources = {
  'blinky.pcb.tsx': [
    { start: [8, 3], end: [11, 6], uids: ['item:4', 'item:10'], outer: ['item:4', 'item:10'], refs: [] },
    { start: [10, 6], end: [10, 53], uids: ['item:10'], refs: [] },
    { start: [26, 5], end: [26, 28], uids: ['item:4', 'item:10'], outer: ['item:4', 'item:10'], refs: ['R2'] },
    { start: [39, 6], end: [39, 34], uids: ['item:82'], refs: [] },
    { start: [41, 6], end: [41, 30], uids: ['item:90', 'item:91'], refs: [] },
  ],
}
const board = { sources, footprints: [], items: [4, 10, 82, 90, 91].map(id => ({ id, uid: `item:${id}` })) }

test('a click on a pour selects its plane; one on empty board clears', () => {
  const site = {
    name: 'B',
    footprints: [],
    nets: ['GND'],
    drc: [],
    erc: [],
    schematic: { parts: [], circuits: [], nets: [] },
    items: [{ id: 82, kind: 'zone', net: 'GND', layers: ['B.Cu'], rings: [] }],
  }
  const s = click(emptySelection('B'), site, { kind: 'zone', id: 82, net: 'GND' }, { shift: false, deep: false })
  assert.deepEqual(s.refs, ['plane:B.Cu:GND'])
  assert.deepEqual(click(s, site, null, { shift: false, deep: false }).refs, [])
})

test('the open request of a pour carries its whole pour() call', () => {
  const q = id => Object.fromEntries(new URLSearchParams(openQuery('blinky.pcb.tsx', sourceTarget(board, { id, ref: null }))))
  assert.deepEqual(q(82), { file: 'blinky.pcb.tsx', line: '39', col: '6', endLine: '39', endCol: '34' })
  assert.deepEqual(q(10), { file: 'blinky.pcb.tsx', line: '10', col: '6', endLine: '10', endCol: '53' })
  assert.deepEqual(q(91), { file: 'blinky.pcb.tsx', line: '41', col: '6', endLine: '41', endCol: '30' })
})
