// The spans a draft preview skipped reach the editor as faint hints, whatever severity the server sent; other diagnostics pass as they are.
// A draft holding the compile names its line in the status bar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { draftHint, holdStatus, DRAFT_SOURCE } = require('../dist/drafts.cjs')

// vscode.DiagnosticSeverity.Hint and vscode.DiagnosticTag.Unnecessary
const HINT = 3
const UNNECESSARY = 1

test('drafts: a skipped span is a hint with the Unnecessary tag, never an error', () => {
  for (const severity of [0, 1, 2, 3, undefined]) {
    const d = draftHint({ source: DRAFT_SOURCE, severity, message: 'skipped in the preview: a syntax error' }, HINT, UNNECESSARY)
    assert.equal(d.severity, HINT)
    assert.deepEqual(d.tags, [UNNECESSARY])
  }
  assert.deepEqual(draftHint({ source: DRAFT_SOURCE, severity: HINT, tags: [UNNECESSARY] }, HINT, UNNECESSARY).tags, [UNNECESSARY])
})

test('drafts: DRC and ERC findings keep their severity', () => {
  const drc = { source: 'pcbjs DRC', severity: 0, code: 'clearance', message: 'too close' }
  assert.deepEqual(draftHint({ ...drc }, HINT, UNNECESSARY), drc)
})

test('drafts: a held compile reads in the status bar with its file and line, and nothing once it compiled', () => {
  assert.equal(holdStatus({ file: 'pcb.tsx', line: 42 }), 'pcbjs: holding, pcb.tsx:42 has an error')
  assert.equal(holdStatus({ file: 'boards/blinky.pcb.tsx', line: 7 }), 'pcbjs: holding, boards/blinky.pcb.tsx:7 has an error')
  assert.equal(holdStatus(null), null)
  assert.equal(holdStatus(undefined), null)
})
