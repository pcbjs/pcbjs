// Unknown coordinate units produce diagnostics at their source tokens.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unitsOf } from '../dist/units.js'
import { parse } from '../dist/doc.js'

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
