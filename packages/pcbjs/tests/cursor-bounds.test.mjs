// A cursor is inside a source range strictly after its first character and at most before its last: the ranges come from the
// real source-range transform, and the viewer resolves cursors against them as it does for an editor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transformSourceRanges } from '@pcbjs/cli/source-ranges'
import { resolveCursor } from '@pcbjs/viewer/src/source.ts'

const code = `import { route } from '@pcbjs/core'
export default () => (
  <PCB name="T">
    <g at="1 1">
      <R1 at="0 0"/>
      <Box at="2 0">
        <C1 at="0 0" />
      </Box>
    </g>
    {route(J1[3]).V(14).H(5)}
  </PCB>
)
`
// every range the transform wrote, named by the text it starts with, one id each
const out = transformSourceRanges(code, '/p/main.tsx', 'main.tsx').code
const ranges = [...out.matchAll(/\{ file: "main\.tsx", line: (\d+), col: (\d+), endLine: (\d+), endCol: (\d+)(?:, fn: \{[^}]*\})? \}/g)]
  .map((m, i) => ({ start: [+m[1], +m[2]], end: [+m[3], +m[4]], ids: [i], refs: [] }))
const lines = code.split('\n')
const name = r => lines[r.start[0] - 1].slice(r.start[1] - 1).match(/^<?[A-Za-z0-9]+/)[0]
const sources = { 'main.tsx': ranges }
const at = (line, col) => { const h = resolveCursor(sources, 'main.tsx', line, col); return h ? name(h.range) : null }

test('the transform records the last character as the end, inclusive', () => {
  assert.deepEqual(ranges.map(name), ['<PCB', '<g', '<R1', '<Box', '<C1', 'route', 'V', 'H'])
  const r1 = ranges[2]
  assert.equal(lines[4][r1.start[1] - 1], '<')
  assert.equal(lines[4][r1.end[1] - 1], '>')
})

test('a self closing element: right before < and right after > are outside', () => {
  assert.equal(at(5, 7), '<g')
  assert.equal(at(5, 8), '<R1')
  assert.equal(at(5, 20), '<R1')
  assert.equal(at(5, 21), '<g')
})

test('an element with children and a nested group: its own edges, the closing tag and the child edges', () => {
  assert.equal(at(4, 5), '<PCB')
  assert.equal(at(4, 6), '<g')
  assert.equal(at(9, 8), '<g')
  assert.equal(at(9, 9), '<PCB')
  assert.equal(at(6, 7), '<g')
  assert.equal(at(6, 8), '<Box')
  assert.equal(at(7, 9), '<Box')
  assert.equal(at(7, 10), '<C1')
  assert.equal(at(7, 23), '<C1')
  assert.equal(at(7, 24), '<Box')
  assert.equal(at(8, 12), '<Box')
  assert.equal(at(8, 13), '<g')
})

test('a route chain: the call and each chain step end at their closing parenthesis', () => {
  assert.equal(at(10, 6), '<PCB')
  assert.equal(at(10, 7), 'route')
  assert.equal(at(10, 17), 'route')
  assert.equal(at(10, 18), '<PCB')
  assert.equal(at(10, 19), '<PCB')
  assert.equal(at(10, 20), 'V')
  assert.equal(at(10, 23), 'V')
  assert.equal(at(10, 24), '<PCB')
  assert.equal(at(10, 28), 'H')
  assert.equal(at(10, 29), '<PCB')
})

test('the root element: before it and after it is no range at all', () => {
  assert.equal(at(3, 3), null)
  assert.equal(at(11, 8), '<PCB')
  assert.equal(at(11, 9), null)
  assert.equal(at(1, 1), null)
})
