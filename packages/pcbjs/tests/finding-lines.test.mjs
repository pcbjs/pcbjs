// The viewer's finding lines on compiled boards: an unrouted net's unconnected finding and a blocked route's route-failed finding are
// drawn as the ratsnest line they name, so neither leaves a marker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { keepout, route } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { siteData } from '@pcbjs/export/internal/site-data'
import { findingLines, findingNotes } from '@pcbjs/ui'
import { fp, handle } from './parts.mjs'

const smd = (ref, x, y, net) => fp({ ref, at: `${x} ${y}`, nets: { 1: net } }, h('pad', { num: 1, size: 1, type: 'smd' }))
const site = (...children) =>
  siteData(compileBoard(h(PCB, { name: 'Lines' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 10 }), ...children)), {
    root: '/',
    fabUrl: '',
    fabName: '',
    fabFiles: [],
    fabStatus: 'ok',
    svgUrl: '',
    dev: false,
    bom: [],
  })

test('an unconnected net: its one ratsnest line carries the unconnected finding', () => {
  const s = site(smd('J1', 5, 5, 'SIG'), smd('J2', 15, 5, 'SIG'))
  assert.equal(s.ratsnest.length, 1)
  const lines = findingLines(s)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].rats, 0)
  assert.deepEqual(
    lines[0].findings.map(d => d.rule),
    ['unconnected'],
  )
  assert.deepEqual(
    findingNotes(s, lines).map(n => [n.rule, n.line]),
    [['unconnected', 0]],
  )
})

test('a route a keepout blocks: route-failed and unconnected ride the same ratsnest line, no marker left', () => {
  const s = site(
    smd('J1', 5, 5, 'SIG'),
    smd('J2', 15, 5, 'SIG'),
    keepout('M 9 -1 h 2 v 12 h -2 Z', { layers: ['F.Cu', 'B.Cu'] }),
    route(handle('J1.1'), handle('J2.1')).width(0.25),
  )
  assert.ok(s.drc.some(d => d.rule === 'route-failed'))
  const lines = findingLines(s)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].rats, 0)
  assert.deepEqual(lines[0].findings.map(d => d.rule).sort(), ['route-failed', 'unconnected'])
  assert.ok(findingNotes(s, lines).every(n => n.line === 0))
})
