// The Name this part action reads the refs the compiled boards hold, so it never proposes one the compiler already gave an unnamed part.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractAction, freezeAction } from '../dist/actions.js'
import { boardFacts } from '../dist/facts.js'
import { docOf } from '../dist/doc.js'
import { projects } from '../dist/project.js'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = `import PCB, { nets, Place } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'

const { A, B } = nets()

export default (
  <PCB name="N">
    <Place part={R0603('1k').connect({ 1: A, 2: B })} at="5 5" />
    <Place part={R0603('4k7').connect({ 1: A, 2: B })} at="10 5" />
  </PCB>
)
`

function setup() {
  const dir = mkdtempSync(join(here, '.actions-'))
  const file = join(dir, 'pcb.tsx')
  writeFileSync(file, SRC)
  const code = projects({ get: f => (f === file ? { text: SRC, version: 1 } : undefined) })
  return { dir, file, uri: pathToFileURL(file).href, doc: docOf(file, SRC), code, done: () => (code.dispose(), rmSync(dir, { recursive: true, force: true })) }
}

const lineOf = needle => SRC.slice(0, SRC.indexOf(needle)).split('\n').length - 1
const at = (needle, d = 2) => {
  const line = lineOf(needle)
  const character = SRC.split('\n')[line].indexOf(needle) + d
  return { start: { line, character }, end: { line, character } }
}

test('extract: the compiled board holds an unnamed R1, so the next inline part is named R2', () => {
  const s = setup()
  try {
    // what the last compile made of the first inline part: R1, at its line
    const site = { name: 'N', schematic: { parts: [{ ref: 'R1', prefix: 'R', src: { file: 'pcb.tsx', line: lineOf("R0603('1k')") + 1, col: 18 } }] } }
    const f = boardFacts([{ root: s.dir, site }]).forFile(s.file)
    const [second] = extractAction(s.uri, s.doc, f, s.code, at("R0603('4k7')"))
    assert.equal(second.title, 'Name this part R2')
    const edits = second.edit.changes[s.uri]
    assert.equal(edits.length, 2)
    assert.ok(edits.some(e => e.newText === 'R2'))
    assert.ok(edits.some(e => e.newText.startsWith("const R2 = R0603('4k7')")))
    const [first] = extractAction(s.uri, s.doc, f, s.code, at("R0603('1k')"))
    assert.equal(first.title, 'Name this part R1', 'a part keeps the ref the compiler gave it')
    const [blind] = extractAction(s.uri, s.doc, boardFacts([]).forFile(s.file), s.code, at("R0603('4k7')"))
    assert.equal(blind.title, 'Name this part R1', 'without the compiled boards only the file says what is taken')
  } finally {
    s.done()
  }
})

test('freeze: offered on a line of a part with an auto slot, never elsewhere', () => {
  const s = setup()
  try {
    const line = lineOf("R0603('1k')")
    const placements = { lines: [line + 1], edits: [{ start: 0, end: 0, newText: '' }] }
    const here = { start: { line, character: 0 }, end: { line, character: 0 } }
    assert.equal(freezeAction(s.uri, s.doc, here, placements)[0].title, 'Freeze the auto placement of this file')
    assert.deepEqual(freezeAction(s.uri, s.doc, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, placements), [])
    assert.deepEqual(freezeAction(s.uri, s.doc, here, null), [])
  } finally {
    s.done()
  }
})
