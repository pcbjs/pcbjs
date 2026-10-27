// A model file path is relative to the file that wrote the `model` literal, as an import is: the part call's file for a
// part option, the element's file for a <footprint> or a component given `model`; absolute paths and generated models pass.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { anchorModel, jsx } from '../dist/jsx-runtime.js'

const HERE = dirname(fileURLToPath(import.meta.url))

test('anchorModel resolves a relative file against the writing file and keeps the path as written', () => {
  const m = anchorModel({ file: './models/a.step', offset: [1, 0, 0] }, '/p/board/lib/parts.tsx')
  assert.equal(m.file, './models/a.step')
  assert.equal(m.step, '/p/board/lib/models/a.step')
  assert.deepEqual(m.offset, [1, 0, 0])
  // once anchored it stays, wherever it is passed on
  assert.equal(anchorModel(m, '/elsewhere/x.tsx').step, '/p/board/lib/models/a.step')
  // the older name step, an absolute path, a file: URL and a generated model are left as they are
  assert.equal(anchorModel({ step: '../m/b.wrl' }, '/p/board/pcb.tsx').step, '/p/m/b.wrl')
  assert.equal(anchorModel({ file: '/abs/c.step' }, '/p/pcb.tsx').step, undefined)
  assert.equal(anchorModel({ file: 'file:///abs/c.step' }, '/p/pcb.tsx').step, undefined)
  const box = { kind: 'box', w: 1, h: 1, height: 1 }
  assert.equal(anchorModel(box, '/p/pcb.tsx'), box)
})

test('a <footprint> element is anchored at the file that wrote it; a part option is tested through the cli in model-paths', () => {
  const el = jsx('footprint', { ref: 'U1', model: { file: './m/x.step' } })
  assert.equal(el.props.model.step, join(HERE, 'm', 'x.step'))
})
