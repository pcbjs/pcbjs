// inspect: net:NAME of the reference grammar, and both answers for a bare name that is a part and a net, D3 the LED and D3 the net.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { fp, net } from './parts.mjs'
import { inspectBoard } from '../dist/project/inspect.js'

const pad = (ref, x, net) => fp({ ref, value: 'V', id: 'pcbjs:TestPad', at: `${x}mm 10mm`, 'net:pad1': net, bom: false }, h('pad', { num: 1, size: 2, shape: 'circle', drill: 1 }))
const board = () =>
  compileBoard(
    h(PCB, { name: 'Clash' }, h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 30 V 20 H 0 Z' }), pad('D3', 5, 'A'), pad('TP1', 15, 'D3'), pad('TP2', 25, 'D3'), pad('TP3', 20, 'A')),
  )

test('inspect: a bare name that is both a part and a net prints both', () => {
  const r = inspectBoard(board(), 'pcb.tsx', '/', 'D3')
  assert.ok(r.found)
  assert.match(r.text.join('\n'), /D3 is both a part and a net/)
  assert.match(r.text.join('\n'), /net D3 {2}2 pads/)
  assert.equal(r.json.part.ref, 'D3')
  assert.equal(r.json.net.net.ref, 'net:D3')
})

test('inspect: net: asks for the net, a pad under the part asks for the part', () => {
  const b = board()
  const n = inspectBoard(b, 'pcb.tsx', '/', 'net:D3')
  assert.equal(n.json.net.ref, 'net:D3')
  assert.equal(n.json.pads.length, 2)
  assert.doesNotMatch(n.text.join('\n'), /both/)
  assert.equal(inspectBoard(b, 'pcb.tsx', '/', 'D3/1').json.pad.ref, 'D3/1')
  assert.equal(inspectBoard(b, 'pcb.tsx', '/', 'part:D3').found, false, 'part: is no kind of the grammar')
  const miss = inspectBoard(b, 'pcb.tsx', '/', 'net:TP1')
  assert.equal(miss.found, false)
  assert.match(miss.text.join('\n'), /no net TP1/)
  // a name only one kind has answers as before
  assert.equal(inspectBoard(b, 'pcb.tsx', '/', 'TP1').json.part.ref, 'TP1')
  assert.equal(inspectBoard(b, 'pcb.tsx', '/', 'A').json.net.ref, 'net:A')
})

test('inspect --json: a part has one shape whether or not its ref names a net too', () => {
  const b = board()
  const both = inspectBoard(b, 'pcb.tsx', '/', 'D3').json
  const alone = inspectBoard(b, 'pcb.tsx', '/', 'TP1').json
  assert.deepEqual(Object.keys(both), ['frame', 'part', 'net'])
  assert.deepEqual(Object.keys(alone), ['frame', 'part'])
  assert.deepEqual(Object.keys(both.part), Object.keys(alone.part))
  assert.equal(both.net.frame, undefined)
})
