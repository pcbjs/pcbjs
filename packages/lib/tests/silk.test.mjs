// The silk of the connector and header families: 'open' leaves the mating side of a side entry connector out, so one placed
// flush with the board edge draws no silk across it; 'full' closes it; 'none' draws no silk, as KiCad's NoSilkScreen variants.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, NC } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { JST_PH, PinHeader, USBC } from '../dist/index.js'

const open = p => p.connect(Object.fromEntries(p.pins.map(n => [n, NC])))
// the side entry's mating face is 6.25 mm from its pin row: at y 33.75 it lies on the board edge at y 40
const flush = part => compileBoard(h(PCB, { name: 'S' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 40 }), h(open(part), { at: '20 33.75' })), { routeCache: false })
const silk = b => b.items.filter(i => /SilkS$/.test(i.layer ?? '') && i.ref === 'J1' && i.kind !== 'text')
const overEdge = b => b.drc.filter(d => d.rule === 'silk-over-edge')

test('JST_PH side: the mating face stays open by default, so a part flush with the edge draws no silk over it', () => {
  const b = flush(JST_PH(6, 'side'))
  assert.ok(silk(b).length > 0)
  assert.deepEqual(overEdge(b), [])
  assert.equal(b.footprints[0].id, 'pcbjs:JST_PH_S6B-PH-K_1x06_P2.00mm_Horizontal')
})

test('JST_PH side: silk full closes the outline across the mating face, silk none draws nothing', () => {
  const full = flush(JST_PH(6, 'side', { silk: 'full' }))
  assert.ok(overEdge(full).length > 0, 'the closed outline runs over the edge')
  assert.match(full.footprints[0].id, /_SilkFull$/)
  const none = flush(JST_PH(6, 'side', { silk: 'none' }))
  assert.deepEqual(silk(none), [])
  assert.match(none.footprints[0].id, /_NoSilkScreen$/)
  assert.deepEqual(silk(flush(JST_PH.footprint(6, 'side', { silk: 'none' })('S6B'))), [])
})

test('silk: the other families take it too; open on a family without a mating side is full; a wrong mode throws', () => {
  const top = m => silk(flush(JST_PH(2, 'top', m ? { silk: m } : undefined))).length
  assert.equal(top('open'), top())
  assert.equal(top('none'), 0)
  assert.deepEqual(silk(flush(PinHeader(3, { silk: 'none' }))), [])
  assert.ok(silk(flush(PinHeader(3))).length > 0)
  assert.deepEqual(silk(flush(USBC({ silk: 'none' }))), [])
  assert.throws(() => JST_PH(2, 'side', { silk: 'off' }), /silk must be 'full', 'open', 'none'/)
})
