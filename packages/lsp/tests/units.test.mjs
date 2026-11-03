// Units in the editor: a hint after each bare number of a length, position and rotation, grid units under a grid with the glyph and its
// location, no hint for an explicit unit, `rad` only explicit, and the number, unit and layer tokens of coordinate strings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { elementAround, encodeTokens, gridLabel, gridTooltip, unitsOf } from '../dist/units.js'
import { docOf, parse } from '../dist/doc.js'

const FIXTURE = `export default (
  <PCB name="U">
    <R1 at="9 7.5" />
    <R2 at="3 4 90" />
    <R3 at="100mil 2mm 45deg" />
    <C1 at="1 2 1.57rad" />
    <pad num={1} at="0 0" size={0.6} drill="0.3mm" />
    {via(GND, '5 5', { drill: 0.3 })}
    {route('3 10 B.Cu').net(V).width(0.3).L(5, 16).A(6, 17, 90).via('F.Cu').H('2mm')}
  </PCB>
)
`
const at = s => FIXTURE.indexOf(s)
const G = { name: 'g', pitch: 2.54, origin: [0, 0], angle: 0, at: { file: '/p/pcb.tsx', line: 1, col: 1 } }

test('hints: mm after each bare length, deg after a bare rotation, nothing after an explicit unit', () => {
  const { hints } = unitsOf(parse(FIXTURE, 'pcb.tsx'))
  const after = hints.map(h => [FIXTURE.slice(FIXTURE.lastIndexOf('"', h.offset - 1) + 1, h.offset), h.unit])
  assert.deepEqual(after.slice(0, 7), [
    ['9', 'mm'],
    ['9 7.5', 'mm'],
    ['3', 'mm'],
    ['3 4', 'mm'],
    ['3 4 90', 'deg'],
    ['1', 'mm'],
    ['1 2', 'mm'],
  ])
  assert.ok(!hints.some(h => h.offset > at('100mil') && h.offset < at('<C1')), 'explicit units take no hint')
  assert.ok(!hints.some(h => h.offset === at('1.57rad') + 7), 'rad is written, never inferred')
  for (const s of ['size={0.6', 'drill: 0.3', 'width(0.3', 'L(5', 'L(5, 16'])
    assert.ok(
      hints.some(h => h.offset === at(s) + s.length && h.unit === 'mm'),
      s,
    )
  assert.ok(
    hints.some(h => h.offset === at('A(6, 17, 90') + 'A(6, 17, 90'.length && h.unit === 'deg'),
    'an arc angle is degrees',
  )
})

test('grid units: a placement under a grid gets the glyph, its pitch and the grid it names, its rotation stays degrees', () => {
  const line = FIXTURE.split('\n').findIndex(l => l.includes('<R2')) + 1
  const { hints } = unitsOf(parse(FIXTURE, 'pcb.tsx'), (l, c) => (l === line && c === 5 ? G : null))
  const r2 = hints.filter(h => h.offset > at('<R2') && h.offset < at('<R3'))
  assert.deepEqual(
    r2.map(h => [h.unit, h.grid?.name ?? null]),
    [
      ['mm', 'g'],
      ['mm', 'g'],
      ['deg', null],
    ],
  )
  assert.deepEqual(gridLabel(G), ['·', '⊞', '2.54mm'])
  assert.equal(gridTooltip(G), 'grid g: pitch 2.54 mm, origin 0 0')
  assert.deepEqual(elementAround(parse(FIXTURE, 'pcb.tsx'), at('3 4 90')), { line, col: 5 })
})

test('tokens: numbers, units and layers inside the strings, encoded relative for semantic tokens', () => {
  const { tokens } = unitsOf(parse(FIXTURE, 'pcb.tsx'))
  const text = t => `${t.type}:${FIXTURE.slice(t.start, t.end)}`
  const r3 = tokens.filter(t => t.start > at('<R3') && t.start < at('<C1')).map(text)
  assert.deepEqual(r3, ['number:100', 'unit:mil', 'number:2', 'unit:mm', 'number:45', 'unit:deg'])
  const route = tokens.filter(t => t.start > at('route(')).map(text)
  assert.deepEqual(route, ['number:3', 'number:10', 'layer:B.Cu', 'layer:F.Cu', 'number:2', 'unit:mm'])
  const data = encodeTokens(docOf('t.tsx', 'a "1mm"\n"2"').pos, [
    { start: 3, end: 4, type: 'number' },
    { start: 4, end: 6, type: 'unit' },
    { start: 9, end: 10, type: 'number' },
  ])
  assert.deepEqual(data, [0, 3, 1, 0, 0, 0, 1, 2, 1, 0, 1, 1, 1, 0, 0])
})

test('a unit the compiler does not know: a diagnostic at the token', () => {
  const text = 'export default <R1 at="5mx 2 1turn" />\n'
  const { bad } = unitsOf(parse(text, 'pcb.tsx'))
  assert.deepEqual(
    bad.map(b => [text.slice(b.start, b.end), b.message.split(':')[0]]),
    [
      ['mx', 'unknown unit mx'],
      ['turn', 'unknown unit turn'],
    ],
  )
})
