import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import './vscode.mjs'

const { boardEntries } = createRequire(import.meta.url)('../dist/icons.cjs')

test('board entries exclude untracked Git files but retain declared files outside Git', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-board-entries-'))
  try {
    writeFileSync(join(root, 'pcb.config.ts'), "export default { entries: ['a.tsx', 'scratch.tsx'] }")
    for (const f of ['a.tsx', 'scratch.tsx']) writeFileSync(join(root, f), 'export default null')
    assert.deepEqual(await boardEntries(root), [join(root, 'a.tsx'), join(root, 'scratch.tsx')])
    execFileSync('git', ['init', '-q', root])
    execFileSync('git', ['-C', root, 'add', 'pcb.config.ts', 'a.tsx'])
    assert.deepEqual(await boardEntries(root), [join(root, 'a.tsx')])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
