import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { absFile, stepSpec } from '../dist/models.js'

test('a relative shared-library source resolves from its canonical loader root', () => {
  const root = path.resolve('/workspace/board')
  const files = new Set([path.resolve('/workspace/lib/parts.tsx'), path.resolve('/unrelated/lib/parts.tsx')])
  assert.equal(absFile('../lib/parts.tsx', files, path, root), path.resolve('/workspace/lib/parts.tsx'))
  const spec = stepSpec({ file: './part.step' }, 'U1', [{ file: '../lib/parts.tsx' }], files, root)
  assert.equal(spec.path, path.resolve('/workspace/lib/part.step'))
  assert.equal(absFile(path.resolve('/workspace/lib/parts.tsx'), files, path, root), path.resolve('/workspace/lib/parts.tsx'))
})
