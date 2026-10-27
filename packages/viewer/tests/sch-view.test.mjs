// The schematic view's geometry and its cross-probe mapping, imported straight from the client TypeScript.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCH_LAYERS, boardProbe, drawnBox, layerCounts, schAtCursor, schFindingAt, schHit, schMarks, schVars, symbolFrame } from '../src/schview.ts'
import { parseViewQuery, queryMode } from '../src/query.ts'

const src = (line, col, endLine, endCol) => ({ file: 'pcb.tsx', line, col, endLine, endCol })
const drawing = {
  grid: 2.54, page: [2.54, 2.54, 120, 80], title: 'T',
  symbols: [{
    ref: 'R1', value: '10k', kind: 'resistor', at: [11.27, 13.81], rot: 0, flip: false, m: [2.54, 0, 0, 2.54, 11.27, 13.81], body: [], box: [10, 10, 12.54, 17.62],
    pins: [
      { name: '1', net: 'A', nc: false, end: [11.27, 7.46], root: [11.27, 10], side: 'top', items: [1] },
      { name: '2', net: 'B', nc: false, end: [11.27, 20.16], root: [11.27, 17.62], side: 'bottom', items: [2] },
    ],
    names: false, refAt: [13, 12], valueAt: [13, 15], auto: false, path: ['P1'], items: [1, 2], src: src(5, 5, 5, 40),
  }],
  wires: [{ id: 'wire:0', net: 'A', pts: [[11.27, 7.46], [30, 7.46]], auto: false, src: src(7, 5, 7, 30) }],
  labels: [{ id: 'label:0', net: 'B', at: [11.27, 20.16], side: 'bottom', kind: 'gnd', auto: true }],
  junctions: [], noConnects: [], texts: [],
  sheets: [{ name: 'P1', path: ['P1'], box: [5, 5, 40, 30], auto: false, src: src(4, 3, 9, 12) }],
  stats: { symbols: 1, wires: 1, segments: 1, bends: 0, crossings: 0, labels: 1, power: 1, junctions: 0, length: 18.73, wired: 1, labelled: 1, rounds: 0 },
}

test('the view query opens the schematic with view=sch', () => {
  assert.equal(parseViewQuery('?view=sch').view, 'sch')
  assert.equal(queryMode(parseViewQuery('?view=SCH&select=Q1')), 'sch')
  assert.equal(parseViewQuery('?view=schematic').view, null)
})

test('a hit names the pin, the wire, the label, the symbol body and the sheet border, in that order', () => {
  const pin = schHit(drawing, [11.3, 8], 0.2)
  assert.deepEqual({ kind: pin.kind, key: pin.key, ref: pin.ref, pin: pin.pin, net: pin.net, items: pin.items }, { kind: 'pin', key: 'pin:R1.1', ref: 'R1', pin: '1', net: 'A', items: [1] })
  assert.equal(schHit(drawing, [20, 7.5], 0.2).key, 'wire:0')
  assert.equal(schHit(drawing, [11.27, 21], 0.2).key, 'label:0', 'without measured bounds a label is a grid square at its point')
  assert.equal(schHit(drawing, [11.27, 30], 0.2, new Map([['label:0', [10, 20, 13, 31]]])).key, 'label:0', 'measured bounds win')
  const body = schHit(drawing, [11, 14], 0.2)
  assert.equal(body.kind, 'symbol')
  assert.deepEqual(body.items, [1, 2])
  assert.deepEqual(body.src, src(5, 5, 5, 40))
  const sheet = schHit(drawing, [5.1, 25], 0.2)
  assert.equal(sheet.key, 'sheet:P1')
  assert.deepEqual(sheet.refs, ['R1'])
  assert.equal(schHit(drawing, [25, 25], 0.2), null, 'the inside of a sheet is empty paper')
})

test('symbol to part and net, and a board item back to its symbol, pin and net', () => {
  assert.deepEqual(boardProbe(schHit(drawing, [11.3, 19], 0.2)), { refs: ['R1'], net: 'B', ids: [2] })
  assert.deepEqual(boardProbe(schHit(drawing, [11, 14], 0.2)), { refs: ['R1'], net: null, ids: [1, 2] })
  assert.deepEqual(boardProbe(null), { refs: [], net: null, ids: [] })
  // the 2D view hovers pad 2 of R1: its pin, its symbol and its net are marked
  assert.deepEqual(schMarks(drawing, { ref: 'R1', net: 'B', id: 2 }), { refs: ['R1'], nets: ['B'], pins: ['R1.2'] })
  assert.deepEqual(schMarks(drawing, { ref: 'U9', net: null, id: 99 }), { refs: [], nets: [], pins: [] }, 'a part without a symbol marks nothing')
  assert.deepEqual(schMarks(drawing, null), { refs: [], nets: [], pins: [] })
})

test('a schematic finding pans the sheet to its point, a board finding does not', () => {
  assert.deepEqual(schFindingAt({ layer: 'sch', at: [30, 7.46] }), [30, 7.46])
  assert.equal(schFindingAt({ layer: 'F.Cu', at: [1, 2] }), null)
  assert.equal(schFindingAt({ at: [1, 2] }), null)
})

test('the frame: the drawn part of the page, and a symbol with room around it', () => {
  const [x, y, w, h] = drawnBox(drawing)
  assert.ok(x >= 2.54 && y >= 2.54 && x <= 5 && y <= 5 && x + w >= 40 && y + h >= 30 && x + w <= 120, 'kept on the page')
  const f = symbolFrame(drawing, 'R1')
  assert.ok(f[0] < 10 && f[1] < 10 && f[0] + f[2] > 12.54 && f[1] + f[3] > 17.62)
  assert.equal(symbolFrame(drawing, 'Q9'), null)
})

test('the editor cursor finds the innermost drawn element and those nested in it', () => {
  assert.deepEqual(schAtCursor(drawing, 'examples/demo/pcb.tsx', 5, 10), { keys: ['sym:R1'], refs: ['R1'], src: src(5, 5, 5, 40) })
  const sheet = schAtCursor(drawing, 'pcb.tsx', 6, 1)
  assert.deepEqual(sheet.keys.sort(), ['sheet:P1', 'sym:R1', 'wire:0'])
  assert.deepEqual(schAtCursor(drawing, 'pcb.tsx', 5, 5).src, src(4, 3, 9, 12), 'a cursor before the first character is outside')
  assert.equal(schAtCursor(drawing, 'other.tsx', 5, 10), null)
})

test('the rail rows, and the colours of a theme as variables', () => {
  assert.deepEqual(schVars({ wire: '#4ade80', paper: '#1b1f27' }), { '--sch-wire': '#4ade80', '--sch-paper': '#1b1f27' })
  assert.deepEqual(schVars(undefined), {})
  assert.deepEqual(SCH_LAYERS.map(l => l.id), ['symbols', 'wires', 'labels', 'power', 'sheets', 'texts', 'findings'])
  assert.deepEqual(layerCounts(drawing, 2), { symbols: 1, wires: 1, labels: 0, power: 1, sheets: 1, texts: 0, findings: 2 })
})
