import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { vscode, group, setGroups } from './vscode.mjs'
const require = createRequire(import.meta.url)

test('finding editor groups: visible source, non-preview, inactive preview, then a new split', () => {
  const { findingColumn } = require('../dist/finding-column.cjs')
  const cases = [
    { groups: [group('/notes.md'), group('/p/custom-layout.tsx'), group('pane')], active: 2, source: '/p/custom-layout.tsx', column: 2 },
    { groups: [group('/notes.md'), group('/p/custom-layout.tsx', 'pane')], active: 1, source: '/p/custom-layout.tsx', column: 1 },
    { groups: [group('pane'), group('/notes.md'), group('pane')], active: 0, source: '/p/missing.tsx', column: 2 },
    { groups: [group('pane'), group('pane')], active: 1, source: '/p/missing.tsx', column: 1 },
    { groups: [group('pane')], active: 0, source: '/p/pcb.tsx', column: vscode.ViewColumn.Beside },
    { groups: [group('/p/pcb.tsx')], active: 0, source: '/p/pcb.tsx', column: 1 },
    { groups: [group('/notes.md'), group('/p/main.pcb.tsx'), group('pane')], active: 2, column: 2 },
    { groups: [group('/notes.md'), group('/other/main.pcb.tsx'), group('pane')], active: 2, column: 1 },
  ]
  for (const c of cases) {
    setGroups(c.groups, c.active)
    assert.equal(findingColumn(c.source, '/p'), c.column)
  }
})

