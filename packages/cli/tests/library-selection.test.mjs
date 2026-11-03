import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { circuit, defineFootprint, h, layout, NC, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { emptySelection } from '@pcbjs/core/internal/selection'
import { editorContext, memberRange } from '../dist/session/selection.js'

function fixture() {
  resetDefaults()
  const Pad = defineFootprint(p => h('footprint', { ...p, bom: false }, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'TP' })
  const channel = circuit('channel', () => ({ R: Pad().connect({ 1: NC }), D: Pad().connect({ 1: NC }) }))
  const A = channel({}, 'A1'), B = channel({}, 'B2')
  const Row = layout(channel, (g, { at }) => h('g', { at }, h(g.R, { at: '0 0' }), h(g.D, { at: '4 0' })), 'Row')
  const board = compileBoard(h(PCB, { name: 'B2' }, h(Row, { g: A, at: '10 10' }), h(Row, { g: B, at: '30 10' })), { cache: false })
  const library = board.schematic.circuits.find(c => c.path.join('/') === 'A1').layout
  return { board, library }
}

test('source definition enters one library context and preserves the previously focused representative', () => {
  const { board, library } = fixture()
  const input = { board: 'B2', library, refs: ['A1/R', 'B2/R'], anchor: 'A1/R', marks: { points: [[10, 10], [30, 10]] } }
  const focused = { ...emptySelection('B2'), refs: ['B2'], anchor: 'B2' }
  const next = editorContext(board, input, focused)
  assert.equal(next.isolate.mode, 'library')
  assert.equal(next.isolate.ref, 'B2')
  assert.deepEqual(next.isolate.instances, ['A1', 'B2'])
  assert.deepEqual(next.refs, ['B2/R'])
  assert.equal(next.anchor, 'B2/R')
  assert.equal(next.marks, undefined, 'world-space marks from other instantiations must not leak')
  const again = editorContext(board, { ...input, refs: ['A1/D', 'B2/D'], anchor: 'A1/D' }, { ...focused, ...next })
  assert.equal(again.isolate.ref, 'B2')
  assert.deepEqual(again.refs, ['B2/D'])
})

test('declaration whitespace focuses the library and leaving the declaration restores board context', () => {
  const { board, library } = fixture()
  const first = editorContext(board, { board: 'B2', library, refs: [], anchor: null }, null)
  assert.equal(first.isolate.ref, 'A1')
  assert.deepEqual(first.refs, ['A1'])
  const next = editorContext(board, { board: 'B2', refs: ['B2/R'], anchor: 'B2/R' }, { ...emptySelection('B2'), ...first, by: 'editor' })
  assert.equal(next.isolate, null)
  assert.equal(next.level, null)
  assert.deepEqual(next.refs, ['B2/R'])
})


test('editor-relative library keys match compiler absolute definition keys only in the same project', () => {
  const { board } = fixture()
  for (const c of board.schematic.circuits) c.layout = '/project/lib/layout.tsx#Row'
  const input = { board: 'B2', library: 'lib/layout.tsx#Row', refs: [], anchor: null }
  assert.equal(editorContext(board, input, null, '/project').isolate.ref, 'A1')
  assert.equal(editorContext(board, input, null, '/other').isolate, undefined)
})

test('a template net remains selectable when its connected parts have no PCB geometry', () => {
  const { board, library } = fixture()
  board.footprints = []
  board.items = []
  for (const p of board.schematic.parts) { p.placed = false; p.pins = [{ name: '1', net: 'N', nc: false }] }
  board.netNames = ['N']
  board.nets = [{ name: 'N' }]
  board.schematic.nets = [{ name: 'N', pins: board.schematic.parts.map(p => `${p.ref}.1`) }]
  const next = editorContext(board, { board: 'B2', library, refs: ['net:N'], anchor: 'net:N' }, null)
  assert.deepEqual(next.refs, ['net:N'])
  assert.equal(next.isolate.ref, 'A1')
})


test('unplaced template symbols jump to their schematic declaration without footprint metadata', () => {
  const { board } = fixture()
  const part = board.schematic.parts[0]
  part.placed = false
  part.displayRef = 'TP0'
  part.src = { file: 'channel.sch.ts', line: 10, col: 5, endLine: 10, endCol: 24 }
  board.footprints = []
  assert.deepEqual(memberRange(board, [...part.path, part.local].join('/'), { view: 'sch' }), part.src)
})
