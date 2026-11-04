import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { sourcePath } from '../dist/source-path.js'

test('source paths are portable within the project and keep external paths intact', () => {
  const root = resolve('project')
  const file = join(root, 'lib', 'Part.tsx')
  assert.equal(sourcePath(root, file), 'lib/Part.tsx')
  assert.equal(sourcePath(root, file.replaceAll('\\', '/')), 'lib/Part.tsx')
  assert.equal(sourcePath(root, 'lib/Part.tsx'), 'lib/Part.tsx')
  const outside = join(root + '-other', 'Part.tsx')
  assert.equal(sourcePath(root, outside), outside)
})
