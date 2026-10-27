// The hover image of schematic code: the element a range drew, cropped from the schematic SVG and outlined.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCH_THEMES, schematicMarkup, schematicStyle } from '@pcbjs/export/sch-svg'
import { schPreview } from '../dist/sch-preview.js'

const src = (line, col, endLine, endCol) => ({ file: 'pcb.tsx', line, col, endLine, endCol })
const drawing = {
  grid: 2.54, page: [5, 5, 260, 190], title: 'T',
  symbols: [{
    ref: 'R1', value: '10k', kind: 'resistor', at: [20, 20], rot: 0, flip: false, m: [2.54, 0, 0, 2.54, 20, 20], body: [{ d: 'M-0.4 -1L0.4 -1L0.4 1L-0.4 1Z' }], box: [19, 17.46, 21, 22.54],
    pins: [{ name: '1', net: 'A', nc: false, end: [20, 14.92], root: [20, 17.46], side: 'top', items: [1] }],
    names: false, refAt: [22, 19], valueAt: [22, 21], auto: false, path: [], items: [1], src: src(5, 5, 5, 40),
  }, {
    ref: 'R9', value: '1k', kind: 'resistor', at: [250, 180], rot: 0, flip: false, m: [2.54, 0, 0, 2.54, 250, 180], body: [], box: [249, 178, 251, 182],
    pins: [], names: false, refAt: [252, 179], valueAt: [252, 181], auto: true, path: [], items: [], src: undefined,
  }],
  wires: [{ id: 'wire:0', net: 'A', pts: [[20, 14.92], [40, 14.92]], auto: false, src: src(7, 5, 8, 12) }],
  labels: [], junctions: [], noConnects: [], texts: [], sheets: [],
  stats: { symbols: 2, wires: 1, segments: 1, bends: 0, crossings: 0, labels: 0, power: 0, junctions: 0, length: 20, wired: 1, labelled: 0, rounds: 0 },
}
const site = { name: 'B', schematic: { parts: [], nets: [], circuits: [], drawing, svg: { markup: schematicMarkup(drawing), style: schematicStyle(), themes: SCH_THEMES } } }
const svgOf = p => Buffer.from(p.uri.split(',')[1], 'base64').toString()

test('a <Sym> range shows its symbol in the dark colours, outlined, with what it is', () => {
  const got = schPreview(site, '/p', '/p/pcb.tsx', 5, 5.5)
  assert.ok(got, 'the first character of the element counts')
  assert.deepEqual(got.lines, ['symbol **R1** 10k'])
  const svg = svgOf(got.preview)
  assert.ok(svg.includes(`.sch-paper{fill:${SCH_THEMES.dark.paper}}`) && !svg.includes('var(--sch-'), 'the dark colours written out')
  assert.ok(svg.includes('[data-kind="symbol"][data-ref="R1"] *{stroke:#6ea8ff!important}'))
  assert.ok(svg.includes('id="sch-sym-R1"') && !svg.includes('sch-sym-R9'), 'elements far off the crop are left out')
  const [x, y, w, h] = got.preview.svg.match(/data-box='([^']+)'/)[1].split(' ').map(Number)
  assert.ok(x <= 19 && y <= 14.92 && x + w >= 21 && y + h >= 22.54, 'the crop holds the symbol and its pin')
  assert.equal(got.preview.width, 360)
})

test('a wire() chain shows its wire; code that drew nothing, another file or an auto symbol show nothing', () => {
  assert.deepEqual(schPreview(site, '/p', '/p/pcb.tsx', 8, 3).lines, ['wire of net **A**'])
  assert.equal(schPreview(site, '/p', '/p/pcb.tsx', 6, 3), undefined)
  assert.equal(schPreview(site, '/p', '/p/other.tsx', 5, 10), undefined)
  assert.equal(schPreview({ ...site, schematic: { ...site.schematic, svg: undefined } }, '/p', '/p/pcb.tsx', 5, 10), undefined)
})
