// A draft repaired with closers keeps its source ranges in the editor's text: a range that ends in the closers ends on the
// overlay's last character instead.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repair } from '@pcbjs/lsp/repair'
import { transformSourceRanges } from '../dist/source-ranges.js'
import { prepare } from '../dist/drafts.js'

const overlay = `import PCB from '@pcbjs/core'\nexport default <PCB name="M">\n  <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />`

test("drafts: a range that ends in the closers ends on the overlay's last character", () => {
  const r = repair(overlay, 'pcb.tsx')
  assert.ok(r.ok && r.limit !== null, r.text)
  const out = transformSourceRanges(r.text, '/p/pcb.tsx', 'pcb.tsx', r.limit).code
  const pcb = /<PCB name="M" __src=\{\{ file: "pcb.tsx", line: (\d+), col: (\d+), endLine: (\d+), endCol: (\d+) \}\}/.exec(out)
  const lines = overlay.split('\n')
  assert.deepEqual(pcb.slice(1).map(Number), [2, 16, lines.length, lines.at(-1).length])
})

test('drafts: prepare keeps text esbuild takes and repairs text it rejects', async () => {
  const ok = await prepare('/p/pcb.tsx', `${overlay}\n</PCB>\n`)
  assert.deepEqual([ok.code === ok.text, ok.skipped, ok.broken], [true, [], false])
  const typing = await prepare('/p/pcb.tsx', `const o = { width: 0.3, d: }\n${overlay}\n</PCB>\n`)
  assert.equal(typing.broken, false)
  assert.equal(typing.text.slice(typing.skipped[0].start, typing.skipped[0].end), 'd:')
  const lost = await prepare('/p/pcb.tsx', Array.from({ length: 6 }, (_, i) => `const v${i} = (\n;`).join('\n'))
  assert.equal(lost.broken, true)
  assert.equal(lost.code, lost.text)
})
