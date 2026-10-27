// inspect: net:NAME and part:REF prefixes, and both answers for a bare name that is a part and a net, D3 the LED and D3 the net.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { inspectBoard } from '../dist/inspect.js'

const pad = (ref, x, net) => h('footprint', { ref, value: 'V', id: 'pcbjs:TestPad', at: `${x}mm 10mm`, 'net:pad1': net, bom: false }, h('pad', { num: 1, size: 2, shape: 'circle', drill: 1 }))
const board = () => compileBoard(h(PCB, { name: 'Clash' },
  h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 30 V 20 H 0 Z' }), pad('D3', 5, 'A'), pad('TP1', 15, 'D3'), pad('TP2', 25, 'D3'), pad('TP3', 20, 'A')))

test('inspect: a bare name that is both a part and a net prints both', () => {
  const r = inspectBoard(board(), 'pcb.tsx', '/', 'D3')
  assert.ok(r.found)
  assert.match(r.text.join('\n'), /D3 is both a part and a net/)
  assert.match(r.text.join('\n'), /net D3 {2}2 pads/)
  assert.equal(r.json.part.footprint.ref, 'D3')
  assert.equal(r.json.net.net, 'D3')
})

test('inspect: net: and part: ask for one kind', () => {
  const b = board()
  const n = inspectBoard(b, 'pcb.tsx', '/', 'net:D3')
  assert.equal(n.json.net, 'D3')
  assert.equal(n.json.pads.length, 2)
  assert.doesNotMatch(n.text.join('\n'), /both/)
  const p = inspectBoard(b, 'pcb.tsx', '/', 'part:D3')
  assert.equal(p.json.footprint.ref, 'D3')
  assert.equal(inspectBoard(b, 'pcb.tsx', '/', 'part:D3.1').json.pads.length, 1)
  const miss = inspectBoard(b, 'pcb.tsx', '/', 'net:TP1')
  assert.equal(miss.found, false)
  assert.match(miss.text.join('\n'), /no net named TP1/)
  // a name only one kind has answers as before
  assert.equal(inspectBoard(b, 'pcb.tsx', '/', 'TP1').json.footprint.ref, 'TP1')
  assert.equal(inspectBoard(b, 'pcb.tsx', '/', 'A').json.net, 'A')
})
