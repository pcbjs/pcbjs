// Docs in hover: the token under the cursor and the excerpt the build-time index gives for it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { docsExcerpt, docsIndex } from '../dist/docs.js'
import { parse } from '../dist/doc.js'

const SRC = `export default <PCB name="X" rev="A">{route(U1[1], R1[2]).Z()}</PCB>`
const at = word => SRC.indexOf(word) + 1

test('the index is built into dist with every topic', () => {
  const i = docsIndex()
  assert.ok(i && i.topics.board && i.topics.routing, 'run the build: it writes dist/docs-index.json')
})

test('route(): the paragraph of routing.md that defines it', () => {
  const x = docsExcerpt(parse(SRC, 'a.tsx'), at('route'))
  assert.equal(x.topic, 'routing')
  assert.match(x.text, /^`route\(a, b, …\)`: the first end is the root/)
})
