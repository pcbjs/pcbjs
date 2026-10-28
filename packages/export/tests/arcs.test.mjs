// Arcs in the Gerbers and the SVG: G75 with G02 and G03 where a path holds an arc, nothing changed where none does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { gerberLayer, layerMarkup } from '../dist/index.js'

const DATE = '2026-01-01T00:00:00.000Z'
// what roundedRect(30, 20, 2) from @pcbjs/lib returns
const ROUNDED = 'M 2 0 H 28 A 2 2 0 0 1 30 2 V 18 A 2 2 0 0 1 28 20 H 2 A 2 2 0 0 1 0 18 V 2 A 2 2 0 0 1 2 0 Z'
const body = text =>
  text
    .slice(text.indexOf('G04 APERTURE END LIST*') + 23)
    .trim()
    .split('\n')
const strip = b => ({ ...b, items: b.items.map(({ prims, ...it }) => it) })

test('arcs: a rounded rectangle outline is four lines and four quarter arcs, token by token', () => {
  const b = compileBoard(h(PCB, { name: 'Round' }, h('path', { layer: 'Edge.Cuts', d: ROUNDED })))
  const g = gerberLayer(b, 'Edge.Cuts', DATE).text
  const head = g.split('\n')
  assert.equal(head[head.indexOf('G01*') + 1], 'G75*')
  assert.deepEqual(body(g), [
    'D10*',
    'X2000000Y0D02*',
    'X28000000Y0D01*',
    'G02*',
    'X30000000Y-2000000I0J-2000000D01*',
    'G01*',
    'X30000000Y-18000000D01*',
    'G02*',
    'X28000000Y-20000000I-2000000J0D01*',
    'G01*',
    'X2000000Y-20000000D01*',
    'G02*',
    'X0Y-18000000I0J2000000D01*',
    'G01*',
    'X0Y-2000000D01*',
    'G02*',
    'X2000000Y0I2000000J0D01*',
    'G01*',
    'M02*',
  ])
})

test('arcs: a layer without arcs is written exactly as before, without G75', () => {
  const b = compileBoard(
    h(
      PCB,
      { name: 'Mixed' },
      h('path', { layer: 'Edge.Cuts', d: ROUNDED }),
      h('path', { layer: 'F.SilkS', d: 'M 1 1 H 5 C 6 1 6 3 5 3 Z' }),
      h('track', { layer: 'F.Cu', width: 0.25, d: 'M 3 3 H 10 V 8' }),
    ),
  )
  for (const layer of ['F.SilkS', 'F.Cu', 'B.Cu']) {
    const text = gerberLayer(b, layer, DATE).text
    assert.doesNotMatch(text, /G75|G02|G03/, layer)
    assert.equal(text, gerberLayer(strip(b), layer, DATE).text, layer)
  }
  assert.notEqual(gerberLayer(b, 'Edge.Cuts', DATE).text, gerberLayer(strip(b), 'Edge.Cuts', DATE).text)
})

test('arcs: a mirrored arc turns the other way in the Gerber, and a track keeps its arc', () => {
  const b = compileBoard(
    h(
      PCB,
      { name: 'Mirror' },
      h('path', { layer: 'Edge.Cuts', d: ROUNDED }),
      h('track', { layer: 'F.Cu', width: 0.25, d: 'M 5 5 A 1 1 0 0 1 7 5' }),
      h('g', { at: '20 10', side: 'B' }, h('track', { layer: 'F.Cu', width: 0.25, d: 'M 0 0 A 1 1 0 0 1 2 0' })),
    ),
  )
  // front: clockwise on the y-down board from (5, 5) over the top to (7, 5), centre (6, 5)
  assert.deepEqual(body(gerberLayer(b, 'F.Cu', DATE).text), ['D10*', 'X5000000Y-5000000D02*', 'G02*', 'X7000000Y-5000000I1000000J0D01*', 'G01*', 'M02*'])
  // back: mirrored about x = 20, from (20, 10) to (18, 10), counter-clockwise
  assert.deepEqual(body(gerberLayer(b, 'B.Cu', DATE).text), ['D10*', 'X20000000Y-10000000D02*', 'G03*', 'X18000000Y-10000000I-1000000J0D01*', 'G01*', 'M02*'])
})

test('arcs: a filled path with arcs is a region whose contour holds the arcs', () => {
  const b = compileBoard(h(PCB, { name: 'Region' }, h('path', { layer: 'Edge.Cuts', d: ROUNDED }), h('circle', { layer: 'F.SilkS', cx: 5, cy: 5, r: 0.5, fill: true })))
  assert.deepEqual(body(gerberLayer(b, 'F.SilkS', DATE).text), [
    'G36*',
    'X5500000Y-5000000D02*',
    'G02*',
    'X4500000Y-5000000I-500000J0D01*',
    'X5500000Y-5000000I500000J0D01*',
    'G01*',
    'G37*',
    'M02*',
  ])
})

test('arcs: the layer SVG draws arcs as A commands, sweep 1 for clockwise', () => {
  const b = compileBoard(h(PCB, { name: 'Svg' }, h('path', { layer: 'Edge.Cuts', d: ROUNDED })))
  const svg = layerMarkup(b, 'Edge.Cuts')
  assert.match(svg, / d="M2 0L28 0A2 2 0 0 1 30 2L30 18A2 2 0 0 1 28 20L2 20A2 2 0 0 1 0 18L0 2A2 2 0 0 1 2 0Z"/)
})
