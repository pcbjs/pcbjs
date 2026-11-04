import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyEdits } from '../dist/session/write.js'

test('editor refusal to create a file never falls back to disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-refusal-'))
  try {
    const file = join(root, 'new.ts')
    const server = { holder: { id: 'editor', role: 'editor' }, initialized: true, applyEdit: async () => false }
    const hub = { servers: () => [{ key: 'editor', server }], store: () => null }
    const at = { line: 0, character: 0 }
    const result = await applyEdits([{ file, create: true, edits: [{ range: { start: at, end: at }, newText: 'source' }] }], { root, hub })
    assert.equal(result[0].applied, false)
    assert.equal(result[0].via, 'editor')
    assert.match(result[0].reason, /refused/)
    assert.equal(existsSync(file), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
