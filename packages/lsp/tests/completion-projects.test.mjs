import { test } from 'node:test'
import assert from 'node:assert/strict'
import { endFocus, endItems } from '../dist/completions.js'
import { docOf } from '../dist/doc.js'

test('completion metadata retains both projects when a shared source gives the same board and handle', () => {
  const file = '/shared/lib.tsx'
  const contexts = ['/parent', '/parent/nested'].map(project => ({
    project,
    board: 'Same',
    start0: 6,
    end0: 6,
    ends: { slot: 0, append: false, candidates: [{ handle: 'TP1[1]', label: '1 · V', kind: 'pad' }] },
  }))
  const items = endItems(docOf(file, 'route()'), contexts)
  assert.equal(items.length, 1)
  const got = []
  const focus = endFocus((file, value) => got.push({ file, value }))
  focus.resolved(items[0])
  assert.deepEqual(got, [{ file, value: contexts.map(c => ({ project: c.project, board: c.board, handle: 'TP1[1]' })) }])
  focus.dispose()
  assert.deepEqual(got.at(-1), { file, value: null })
  const before = got.length
  focus.resolved({ data: { end: { file, boards: ['Same'], handle: 'TP1[1]' } } })
  assert.equal(got.length, before, 'an unscoped completion does not light a project')
})
