import { resolve } from 'node:path'
// The editor selection model: what a cursor or a selection names per board, as the references the viewers highlight.
import { readFileSync } from 'node:fs'
import { docOf } from '../dist/doc.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardFacts } from '../dist/facts.js'
import { editorSelection } from '../dist/selection.js'

const ROOT = resolve('/p')
const FILE = resolve('/p/pcb.tsx')

/** Line 3 places R1 inside a route element; line 5 draws a wire in the schematic; R7 is member R01 of instance A. */
function facts() {
  const site = {
    name: 'b',
    layers: [],
    footprints: [
      { ref: 'R1', pads: [] },
      { ref: 'R7', pads: [] },
    ],
    items: [
      { id: 1, uid: 'item:a', kind: 'pad', ref: 'R1', net: 'SIG' },
      { id: 2, uid: 'item:b', kind: 'track', net: 'SIG', route: 'route:0' },
      { id: 3, uid: 'item:c', kind: 'graphic' },
    ],
    sources: {
      'pcb.tsx': [
        { start: [3, 1], end: [3, 44], uids: ['item:a', 'item:b', 'item:c'], refs: ['R1'] },
        { start: [3, 21], end: [3, 37], uids: ['item:a'], refs: ['R1'] },
      ],
    },
    routes: [],
    schematic: {
      parts: [{ ref: 'R7', path: ['A'], local: 'R01' }],
      drawing: {
        symbols: [],
        wires: [{ id: 'w1', src: { file: 'pcb.tsx', line: 5, col: 3, endLine: 5, endCol: 20 } }],
        labels: [],
      },
    },
  }
  return boardFacts([{ root: ROOT, site }]).forFile(FILE)
}

const at = (line, character) => ({ start: { line, character }, end: { line, character } })
const none = () => undefined

test('selection: a cursor names the innermost range, a selection every range it holds with their routes and loose items', () => {
  const f = facts()
  assert.deepEqual(editorSelection(f, [at(2, 25)], none), [{ board: 'b', refs: ['R1'], anchor: 'R1' }])
  const whole = { start: { line: 2, character: 0 }, end: { line: 2, character: 44 } }
  assert.deepEqual(editorSelection(f, [whole], none), [{ board: 'b', refs: ['R1', 'route:0', 'item:c'], anchor: 'R1' }], 'the pad goes with its part')
  assert.deepEqual(editorSelection(f, [at(0, 0)], none), [{ board: 'b', refs: [], anchor: null }], 'every board answers, empty when nothing is there')
})

test('selection: a token the type checker resolves names its target, an instance member by its path, with its points and reference marked', () => {
  const f = facts()
  const target = { kind: 'part', start: 0, end: 2, boards: [{ board: 'b', parts: ['R7'], refs: ['R7'], points: [[1, 2]], reference: 'ref1', name: 'R7' }] }
  const got = editorSelection(f, [at(2, 25)], () => target)
  assert.deepEqual(got, [{ board: 'b', refs: ['A/R01'], anchor: 'A/R01', marks: { points: [[1, 2]], reference: 'ref1' } }])
})

test('selection: a cursor inside a schematic wire marks it, and the first range gives the anchor', () => {
  const f = facts()
  assert.deepEqual(editorSelection(f, [at(4, 6)], none), [{ board: 'b', refs: [], anchor: null, marks: { sch: ['w1'] } }])
  const two = editorSelection(f, [at(4, 6), at(2, 25)], none)
  assert.deepEqual(two[0].refs, ['R1'])
  assert.equal(two[0].anchor, 'R1', 'the first range named nothing, so the first ref anchors')
  assert.deepEqual(two[0].marks, { sch: ['w1'] })
})

test('selection: generated reference text source range selects only its item UID', () => {
  const f = facts()
  const board = f.all[0]
  board.site.items.push({ id: 9, uid: 'item:reference', kind: 'text', generated: 'reference', ref: 'R1' })
  board.site.sources['pcb.tsx'].push({ start: [3, 26], end: [3, 35], uids: ['item:reference'], refs: [] })
  const fresh = boardFacts([board]).forFile(FILE)
  const point = { kind: 'point', boards: [{ board: 'b', refs: [], points: [[3, 4]], name: '3 4' }] }
  assert.deepEqual(editorSelection(fresh, [at(2, 29)], () => point)[0].refs, ['item:reference'])
})

test('selection: library context belongs to the declaration, including whitespace, coordinates and routing', () => {
  const file = resolve('/p/lib/led-channel.tsx')
  const text = readFileSync(new URL('../../../examples/demo/lib/led-channel.tsx', import.meta.url), 'utf8')
  const doc = docOf(file, text)
  const key = 'lib/led-channel.tsx#LedChannelRow'
  const site = { name: 'b', sources: {}, schematic: { circuits: [{ layout: key, def: 'lib/led-channel.tsx#ledChannel' }] } }
  const f = boardFacts([{ root: ROOT, site }]).forFile(file)
  const select = (offset, end = offset) => editorSelection(f, [{ start: doc.pos(offset), end: doc.pos(end) }], none, doc)[0]
  for (const needle of ['layout =', '(g, {', 'schematic.layout(', 'g.R at=', '-4mm 0', "route('-3.175", '    <g at=']) {
    assert.equal(select(text.indexOf(needle) + 1).library, key, needle)
  }
  assert.equal(select(text.indexOf('import { circuit') + 10).library, undefined)
  assert.equal(select(0, text.length).library, undefined)
  const board = docOf(
    file,
    `import { LedChannelRow } from './lib/led-channel.layout'
const board = <LedChannelRow at="0 0" />`,
  )
  assert.equal(editorSelection(f, [at(1, 25)], none, board)[0].library, undefined)
})
