// The block of an edit for the compile hold: a statement, a JSX tag or child, the lines of JSX text, and whether it parses on its own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockError, changedBlock } from '../dist/hold.js'
import { docOf, parse } from '../dist/doc.js'

const BASE = `const x = 1
export default (
  <PCB name="A">
    <R1 at="5 10" />
    {route('5 10').H(15)}
  </PCB>
)
`
const lineOf = (text, at) => text.slice(0, at).split('\n').length

// [name, from, to, the block's text after the edit, the line of its error or null]
const table = [
  ['a statement', 'const x = 1', 'const x = (1', 'const x = (1', 1],
  ['a clean statement', 'const x = 1', 'const x = 2', 'const x = 2', null],
  ['a chain call in a JSX child', '.H(15)', '.H(15).V(', "{route('5 10').H(15).V(}", 5],
  ['an attribute in its tag', 'at="5 10"', 'at="5 10" side=', '<R1 at="5 10" side= />', 4],
  ['a new line among the children, with the line it was typed on', '    <R1', '    {route(\n    <R1', '    {route(\n    <R1 at="5 10" />', 5],
]

for (const [name, from, to, block, line] of table)
  test(`the block of ${name}`, () => {
    const after = BASE.replace(from, to)
    const b = changedBlock(docOf('pcb.tsx', BASE), after)
    assert.equal(after.slice(b.start, b.end), block)
    const e = blockError(after, 'pcb.tsx', b)
    assert.equal(e === null ? null : lineOf(after, e), line)
  })

test('an edit inside a held block keeps it and moves its end', () => {
  const t1 = BASE.replace('.H(15)', '.H(15).V(')
  const held = changedBlock(docOf('pcb.tsx', BASE), t1)
  const t2 = t1.replace('.V(', '.V(3)')
  const b = changedBlock(docOf('pcb.tsx', t1), t2, held)
  assert.equal(b.start, held.start)
  assert.equal(t2.slice(b.start, b.end), "{route('5 10').H(15).V(3)}")
  assert.equal(blockError(t2, 'pcb.tsx', b), null)
})
