// Part names in the editor: a hint for a part bound to a name that does not read like a ref, and the code action that names an inline part.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { extractPart, nameHints } from '../dist/names.js'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = `import PCB, { nets, Place } from '@pcbjs/core'
import { R0603, LED0603 } from '@pcbjs/lib'

const { A, B } = nets()
const R1 = R0603('1k').connect({ 1: A, 2: B })
const Rpull = R0603('10k').connect({ 1: A, 2: B })
const LEDS = [1, 2].map(i => LED0603('red', { ref: \`D\${i}\` }))

export default (
  <PCB name="N">
    <R1 at="5 5" />
    <Place part={R0603('4k7').connect({ 1: A, 2: B })} at="10 5" />
    <Place part={LEDS[0]} at="15 5" />
  </PCB>
)
`

function program(text) {
  const dir = mkdtempSync(join(here, '.names-'))
  const file = join(dir, 'pcb.tsx')
  writeFileSync(file, text)
  const p = ts.createProgram([file], {
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: '@pcbjs/core',
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  })
  return { p, file, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('names: a hint on a part binding not named letters then digits, none on R1 or on other values', () => {
  const { p, file, done } = program(SRC)
  try {
    const hints = nameHints(p, file)
    assert.deepEqual(
      hints.map(h => SRC.slice(h.start, h.end)),
      ['Rpull'],
    )
    assert.match(hints[0].message, /ref on the silk and in the BOM/)
  } finally {
    done()
  }
})

test('names: the code action extracts an inline part to a constant with the next free number, and leaves a named part alone', () => {
  const { p, file, done } = program(SRC)
  try {
    const at = SRC.indexOf("R0603('4k7')") + 2
    const x = extractPart(p, file, at, undefined, ['R2'])
    assert.equal(x.title, 'Name this part R3')
    let out = SRC
    for (const e of [...x.edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.newText + out.slice(e.end)
    assert.ok(out.includes("const R3 = R0603('4k7').connect({ 1: A, 2: B })\nexport default"), out)
    assert.ok(out.includes('<Place part={R3} at="10 5" />'), out)
    assert.equal(extractPart(p, file, SRC.indexOf("R0603('1k')") + 2), undefined, 'a bound part')
    assert.equal(extractPart(p, file, SRC.indexOf("LED0603('red'") + 2), undefined, 'a part in a function, with a ref')
    assert.equal(extractPart(p, file, SRC.indexOf('nets()') + 1), undefined, 'no part')
    assert.equal(extractPart(p, file, at, () => 'RX').title, 'Name this part RX1', 'the prefix the compiler knows wins')
  } finally {
    done()
  }
})
