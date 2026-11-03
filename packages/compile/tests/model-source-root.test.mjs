import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { absFile, stepSpec } from '../dist/models.js'

test('a relative shared-library source resolves from its canonical loader root', () => {
  const root = '/workspace/board'
  const files = new Set(['/workspace/lib/parts.tsx', '/unrelated/lib/parts.tsx'])
  assert.equal(absFile('../lib/parts.tsx', files, path, root), '/workspace/lib/parts.tsx')
  const spec = stepSpec({ file: './part.step' }, 'U1', [{ file: '../lib/parts.tsx' }], files, root)
  assert.equal(spec.path, '/workspace/lib/part.step')
  assert.equal(absFile('/workspace/lib/parts.tsx', files, path, root), '/workspace/lib/parts.tsx')
})
