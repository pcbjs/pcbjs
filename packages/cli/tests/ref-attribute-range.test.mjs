import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transformSourceRanges } from '../dist/project/source-ranges.js'

test('reference placement attribute gets an independent source range for label focus', () => {
  const text = 'export default <PCB><R1 at="3 4" ref:at="0 -2" /></PCB>'
  const out = transformSourceRanges(text, '/p/pcb.tsx', 'pcb.tsx')
  const transformed = typeof out === 'string' ? out : out.code
  assert.match(transformed, /__refSrc=\{\{ file: .*line: 1, col: 34, endLine: 1, endCol: 46/)
})
