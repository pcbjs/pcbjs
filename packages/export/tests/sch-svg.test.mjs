// The schematic SVG: one element per symbol, pin, wire and label, keyed like the board, so the viewer can cross-probe.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, defineFootprint, resetDefaults, Schematic, Sheet, group } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { schematicSvg, schematicMarkup, schematicStyle } from '../dist/sch-svg.js'
import { siteData } from '../dist/site-data.js'
import { buildFab } from '../dist/fab.js'

afterEach(() => resetDefaults())

const pad = (num, x) => h('pad', { num, at: [x, 0], size: [0.8, 0.8] })
const R = defineFootprint(p => h('footprint', p, pad(1, -1), pad(2, 1)), { pins: ['1', '2'], prefix: 'R' })

function board(schematic) {
  const { A, B, GND } = nets()
  const parts = [R('1k').connect(A, B), R('2k').connect(B, GND)]
  return compileBoard(
    h(
      PCB,
      { name: 'S', silkRefs: false, ...(schematic ? { schematic } : {}) },
      h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 10 }),
      ...parts.map((p, i) => h(p, { at: [4 + i * 8, 5] })),
    ),
    { routeCache: false },
  )
}

test('symbols, pins, wires and labels carry the ids of the board', () => {
  const b = board()
  const svg = schematicSvg(b, 'dark')
  const pads = b.items.filter(i => i.kind === 'pad')
  assert.match(svg, /^<\?xml/)
  for (const ref of ['R1', 'R2']) {
    assert.match(svg, new RegExp(`<g class="sch-sym" id="sch-sym-${ref}" data-kind="symbol" data-ref="${ref}" data-items="[0-9 ]+"`))
    for (const p of pads.filter(x => x.ref === ref)) assert.ok(svg.includes(`data-ref="${ref}" data-pin="${p.num}" data-net="${p.net}" data-items="${p.id}"`), `${ref}.${p.num}`)
  }
  assert.match(svg, /<path class="sch-wire" id="sch-wire-1" data-kind="wire" data-id="wire:1" data-net="B"/)
  assert.match(svg, /<g class="sch-label sch-power" data-kind="label" data-id="label:\d+" data-net="GND"/)
  assert.ok(svg.includes('--sch-wire:#4ade80'), 'the dark theme')
  assert.ok(schematicSvg(b).includes('--sch-paper:#f5f4ef'), 'light by default')
})

test('the site data carries the drawing and its markup; the fab set its SVG', () => {
  const b = board()
  const site = siteData(b, { root: '/', fabUrl: '', fabName: '', fabFiles: [], fabStatus: '', svgUrl: '', dev: false, bom: [] })
  assert.equal(site.schematic.drawing.symbols.length, 2)
  assert.equal(site.schematic.svg.markup, schematicMarkup(b.schematic.drawing, b))
  assert.ok(!schematicStyle().includes(':root'), 'no colours without a theme')
  assert.ok(buildFab(b).files['S.sch.svg'].includes('id="sch-sym-R1"'))
})

test('the page is the drawing grown by a margin: no frame, title block or paper legend unless a sheet asks', () => {
  const b = board()
  const d = b.schematic.drawing
  const svg = schematicSvg(b)
  const [x0, y0, x1, y1] = d.page
  assert.ok(svg.includes(`viewBox="${x0} ${y0} ${+(x1 - x0).toFixed(3)} ${+(y1 - y0).toFixed(3)}"`), svg.slice(0, 300))
  const markup = schematicMarkup(d, b)
  assert.ok(!markup.includes('sch-border') && !markup.includes('sch-title') && !markup.includes('sch-frame'), 'no frame or title block')
  assert.ok(x1 - x0 < 80 && y1 - y0 < 40, `the page hugs two resistors: ${d.page}`)
  const paper = board(h(Schematic, { sheet: 'A3' }))
  const framed = schematicSvg(paper)
  assert.ok(framed.includes('viewBox="0 0 420 297"') && framed.includes('class="sch-border"') && framed.includes('class="sch-title"'))
})

test('an automatic sheet box draws no name; a <Sheet> the author wrote keeps its own', () => {
  const { A, B, GND } = nets()
  const blk = group('BLK', { R1: R('1k').connect(A, B), R2: R('2k').connect(B, GND) })
  const make = sch =>
    compileBoard(
      h(
        PCB,
        { name: 'G', silkRefs: false, ...(sch ? { schematic: sch } : {}) },
        h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 10 }),
        h(blk.R1, { at: [4, 5] }),
        h(blk.R2, { at: [12, 5] }),
      ),
      { routeCache: false },
    )
  const auto = make()
  assert.equal(auto.schematic.drawing.sheets.length, 1)
  assert.ok(auto.schematic.drawing.sheets[0].auto)
  assert.ok(!schematicMarkup(auto.schematic.drawing, auto).includes('sch-sheet-name'))
  const hand = make(h(Schematic, {}, h(Sheet, { group: blk, name: 'Divider', at: '4 4' })))
  assert.ok(schematicMarkup(hand.schematic.drawing, hand).includes('class="sch-sheet-name"'))
})
