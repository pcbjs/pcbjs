// One text-position model: offsets, zero-based LSP positions and one-based sites with an inclusive end column, and the one diff edit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffEdit, textDoc, toPosition, toRange, toSite } from '../dist/textdoc.js'

const TEXT = 'ab\ncd é\n\nlast'

test('pos and offset are inverse, and clamp past a line or the text', () => {
  const d = textDoc(TEXT)
  assert.deepEqual(d.lines(), [0, 3, 8, 9])
  for (let o = 0; o <= TEXT.length; o++) assert.equal(d.offset(d.pos(o)), o)
  assert.deepEqual(d.pos(4), { line: 1, character: 1 })
  assert.equal(d.offset({ line: 0, character: 99 }), 2)
  assert.equal(d.offset({ line: 9, character: 0 }), TEXT.length)
  assert.equal(d.offset({ line: 3, character: 99 }), TEXT.length)
})

test('a site is one-based with its last column inclusive, at every boundary', () => {
  const d = textDoc(TEXT)
  assert.deepEqual(toPosition({ line: 2, col: 3 }), { line: 1, character: 2 })
  assert.deepEqual(toSite({ line: 1, character: 2 }), { line: 2, col: 3 })
  assert.deepEqual(toRange({ line: 2, col: 1, endLine: 2, endCol: 2 }), { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } })
  assert.deepEqual(toRange({ line: 2, col: 1 }), { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } })
  assert.deepEqual(d.span({ line: 2, col: 1, endLine: 2, endCol: 2 }), { start: 3, end: 5 })
  assert.deepEqual(d.siteOf({ start: 3, end: 5 }), { line: 2, col: 1, endLine: 2, endCol: 2 })
  assert.deepEqual(d.site(9), { line: 4, col: 1 })
})

test('apply takes edits in any order, and diffEdit is the one span between two texts', () => {
  const d = textDoc(TEXT)
  const edits = [d.edit({ start: 0, end: 2, newText: 'AB' }), d.edit({ start: 9, end: 13, newText: 'end' })]
  assert.equal(d.apply(edits), 'AB\ncd é\n\nend')
  assert.equal(d.apply([...edits].reverse()), 'AB\ncd é\n\nend')
  const to = 'ab\ncd ü\n\nlast'
  assert.deepEqual(diffEdit(TEXT, to), { start: 6, end: 7, newText: 'ü' })
  assert.equal(d.apply([d.edit(diffEdit(TEXT, to))]), to)
  assert.deepEqual(diffEdit('', 'new'), { start: 0, end: 0, newText: 'new' })
})
