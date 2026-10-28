// The viewer's schematic helpers and the combined DRC and ERC status, imported straight from the client TypeScript.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSummary, ercSummary, failingCount, worstTarget } from '../src/variants.ts'
import { compareRefs, ercTarget, filterSchematic, knownRefs, orderNets, parsePin, pinLabel, refFromMessage, schematicPart } from '../src/schematic.ts'

const err = { severity: 'error', rule: 'r', message: 'x', at: [0, 0] }
const warn = { severity: 'warning', rule: 'r', message: 'y', at: [0, 0] }

test('without ERC data the status is the DRC alone, as before', () => {
  const s = checkSummary({ drc: [], unconnected: 0 })
  assert.equal(s.state, 'ok')
  assert.equal(s.label, 'DRC clean')
  assert.equal(s.erc, null)
  assert.equal(checkSummary({ drc: [err, warn], unconnected: 1 }).label, 'DRC 1 error · 1 warning · 1 unconnected')
  assert.equal(ercSummary({}), null)
  assert.equal(checkSummary({}).state, 'ok')
  // the DRC list holds an unconnected finding per gap: the pill counts it once
  const gap = { severity: 'error', rule: 'unconnected', message: 'net A is not fully connected', at: [0, 0] }
  assert.equal(checkSummary({ drc: [err, gap, gap], erc: [], unconnected: 2 }).label, 'DRC 3 · ERC 0')
  assert.equal(checkSummary({ drc: [err], erc: [], unconnected: 2 }).label, 'DRC 3 · ERC 0')
})

test('the combined status: red for errors in either, amber for warnings only, green when both are clean', () => {
  assert.equal(checkSummary({ drc: [], erc: [], unconnected: 0 }).state, 'ok')
  assert.equal(checkSummary({ drc: [], erc: [], unconnected: 0 }).label, 'DRC 0 · ERC 0')
  assert.equal(checkSummary({ drc: [], erc: [], unconnected: 0 }).text, 'clean')
  assert.equal(checkSummary({ drc: [], erc: [warn], unconnected: 0 }).state, 'warn')
  assert.equal(checkSummary({ drc: [warn], erc: [err], unconnected: 0 }).state, 'err')
  assert.equal(checkSummary({ drc: [err], erc: [], unconnected: 0 }).state, 'err')
  assert.equal(checkSummary({ drc: [], erc: [], unconnected: 2 }).state, 'err')
  const s = checkSummary({ drc: [warn], erc: [err, warn, warn], unconnected: 1 })
  assert.equal(s.label, 'DRC 2 · ERC 3')
  assert.equal(s.text, 'DRC 1 warning, 1 unconnected · ERC 1 error, 2 warnings')
  assert.equal(s.title, 'DRC: 0 errors, 1 warning, 1 unconnected\nERC: 1 error, 2 warnings')
  assert.deepEqual([s.errors, s.warnings], [1, 3])
  assert.deepEqual(ercSummary({ erc: [warn] }), { state: 'warn', text: '1 warning', errors: 0, warnings: 1, infos: 0 })
})

test('targets rank and fail on DRC and ERC together', () => {
  const t = (drc, erc) => ({ drc, erc, unconnected: 0 })
  const ts = [t([], []), t([warn], []), t([], [err])]
  assert.equal(worstTarget(ts), ts[2])
  assert.equal(failingCount(ts), 1)
  assert.equal(failingCount([{ drc: [], unconnected: 0 }]), 0)
})

test('pin references split at the first dot', () => {
  assert.deepEqual(parsePin('R1.2'), { ref: 'R1', pin: '2' })
  assert.deepEqual(parsePin('U3.PA0'), { ref: 'U3', pin: 'PA0' })
  assert.equal(parsePin('R1'), null)
  assert.equal(parsePin('.2'), null)
  assert.equal(parsePin('R1.'), null)
})

test('nets follow the declaration order, then the board nets the schematic lacks; without schematic nets the board order stays', () => {
  const board = ['GND', 'LED1', 'VCC', 'X']
  const sch = {
    parts: [],
    nets: [
      { name: 'VCC', class: 'power', local: false, pins: [] },
      { name: 'GND', local: false, pins: [] },
      { name: 'led/A', local: true, pins: [] },
    ],
  }
  assert.deepEqual(orderNets(board, sch), [
    { name: 'VCC', class: 'power', local: false },
    { name: 'GND', local: false },
    { name: 'led/A', local: true },
    { name: 'LED1', local: false },
    { name: 'X', local: false },
  ])
  assert.deepEqual(
    orderNets(board, undefined).map(n => n.name),
    board,
  )
  assert.deepEqual(
    orderNets(board, { parts: [], nets: [] }).map(n => n.name),
    board,
  )
  assert.deepEqual(orderNets(undefined, null), [])
})

const sch = {
  parts: [
    {
      ref: 'R10',
      value: '1k',
      footprint: 'R_0603',
      prefix: 'R',
      placed: true,
      pins: [
        { name: '1', net: 'VCC', nc: false },
        { name: '2', net: 'LED1', nc: false },
      ],
    },
    {
      ref: 'R2',
      value: '10k',
      footprint: 'R_0603',
      prefix: 'R',
      placed: false,
      pins: [
        { name: '1', net: null, nc: true },
        { name: '2', net: null, nc: false },
      ],
    },
    { ref: 'D1', value: 'red', footprint: 'LED_0603', prefix: 'D', placed: true, pins: [{ name: '1', net: 'GND', nc: false }] },
  ],
  nets: [
    { name: 'VCC', class: 'power', local: false, pins: ['R10.1'] },
    { name: 'LED1', local: false, pins: ['R10.2'] },
    { name: 'GND', local: false, pins: ['D1.1'] },
  ],
}

test('parts in natural ref order, one filter for parts and nets', () => {
  assert.deepEqual(
    filterSchematic(sch, '').parts.map(p => p.ref),
    ['D1', 'R2', 'R10'],
  )
  assert.deepEqual(
    filterSchematic(sch, '').nets.map(n => n.name),
    ['VCC', 'LED1', 'GND'],
  )
  const f = filterSchematic(sch, 'gnd')
  assert.deepEqual([f.parts.map(p => p.ref), f.nets.map(n => n.name)], [['D1'], ['GND']])
  assert.deepEqual(
    filterSchematic(sch, 'power').nets.map(n => n.name),
    ['VCC'],
  )
  assert.deepEqual(
    filterSchematic(sch, 'r10.2').nets.map(n => n.name),
    ['LED1'],
  )
  assert.deepEqual(filterSchematic(undefined, 'x'), { parts: [], nets: [] })
  assert.ok(compareRefs('R2', 'R10') < 0 && compareRefs('C1', 'R1') < 0)
  assert.equal(schematicPart(sch, 'R2').placed, false)
  assert.equal(schematicPart(undefined, 'R2'), null)
  assert.equal(schematicPart(sch, null), null)
})

test('pin chips read "1 GND", NC for a pin marked not connected', () => {
  assert.equal(pinLabel({ name: '1', net: 'GND', nc: false }), '1 GND')
  assert.equal(pinLabel({ name: '3', net: null, nc: true }), '3 NC')
  assert.equal(pinLabel({ name: '4', net: null, nc: false }), '4')
})

test('an ERC row goes to its point, else to the part its message or items name', () => {
  const refs = knownRefs({ footprints: [{ ref: 'D1' }], schematic: sch })
  assert.deepEqual(refs.sort(), ['D1', 'R10', 'R2'])
  assert.equal(refFromMessage('pin R10.2 drives nothing', refs), 'R10')
  assert.equal(refFromMessage('part R2 is not placed', refs), 'R2')
  assert.equal(refFromMessage('net GND has one pin', refs), null)
  assert.deepEqual(ercTarget({ at: [3, 4], message: 'R2' }, refs), { kind: 'at', at: [3, 4] })
  assert.deepEqual(ercTarget({ at: [0, 0], message: 'part R2 is not placed' }, refs), { kind: 'ref', ref: 'R2' })
  assert.deepEqual(ercTarget({ at: [0, 0], message: 'nothing here' }, refs, ['D1']), { kind: 'ref', ref: 'D1' })
  assert.equal(ercTarget({ at: [0, 0], message: 'nothing here' }, refs), null)
  assert.deepEqual(knownRefs({ footprints: [] }), [])
})

test('info findings count apart from warnings and never turn the status amber', () => {
  const info = { severity: 'info', rule: 'teardrop-dropped', message: 'z', at: [0, 0] }
  const s = checkSummary({ drc: [info, info, warn], erc: [], unconnected: 0 })
  assert.equal(s.state, 'warn')
  assert.deepEqual(s.drc, { errors: 0, warnings: 1, infos: 2 })
  assert.equal(s.text, 'DRC 1 warning, 2 info · ERC clean')
  assert.equal(s.title, 'DRC: 0 errors, 1 warning, 0 unconnected, 2 info\nERC: 0 errors, 0 warnings')
  const only = checkSummary({ drc: [info], erc: [], unconnected: 0 })
  assert.equal(only.state, 'ok')
  assert.equal(only.label, 'DRC 0 · ERC 0')
  assert.equal(only.text, 'DRC 1 info · ERC clean')
  assert.equal(checkSummary({ drc: [info], unconnected: 0 }).label, 'DRC 1 info')
  assert.deepEqual(ercSummary({ erc: [info] }), { state: 'ok', text: '1 info', errors: 0, warnings: 0, infos: 1 })
})
