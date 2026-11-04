import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { padAccessor } from '../dist/signature.js'

for (const marked of ['R1[|]', 'R1[|', 'R1[1|]', 'R1["A|', "R1['A|']", 'CH1.R1[ | ]', 'alias[|2]']) {
  test(`pad accessor tolerates ${marked}`, () => {
    const at = marked.indexOf('|'),
      text = marked.replace('|', '')
    const sf = ts.createSourceFile('test.ts', text, ts.ScriptTarget.Latest, true)
    const found = padAccessor(sf, at)
    assert.ok(found)
    assert.equal(found.receiver.getText(sf), marked.slice(0, marked.indexOf('[')))
  })
}
for (const marked of ['R1|[1]', 'R1[1]|', 'R1[1 + |2]', 'R1[index|]', 'R1[`A|`]', '// R1[|]', '"R1[|]"']) {
  test(`pad accessor excludes ${marked}`, () => {
    const at = marked.indexOf('|'),
      sf = ts.createSourceFile('test.ts', marked.replace('|', ''), ts.ScriptTarget.Latest, true)
    assert.equal(padAccessor(sf, at), undefined)
  })
}

test('ordinary caret requests return before constructing the semantic program or board facts', async () => {
  const { readFileSync } = await import('node:fs')
  const { docOf } = await import('../dist/doc.js')
  const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
  const handler = source.slice(source.indexOf('  connection.onSignatureHelp(p => {'), source.indexOf('  connection.onHover(p => {'))
  let request,
    programCalls = 0,
    factCalls = 0
  let doc = docOf('/test.ts', 'const value = 12;')
  new Function('connection', 'toFile', 'docAt', 'padAccessor', 'code', 'padSignature', 'facts', handler)(
    {
      onSignatureHelp(fn) {
        request = fn
      },
    },
    () => '/test.ts',
    () => doc,
    padAccessor,
    () => {
      programCalls++
      return {
        program() {
          return undefined
        },
      }
    },
    () => {
      throw new Error('unexpected semantic hint')
    },
    () => {
      factCalls++
      return {}
    },
  )
  assert.equal(request({ textDocument: { uri: 'file:///test.ts' }, position: { line: 0, character: 8 } }), null)
  assert.equal(programCalls, 0)
  assert.equal(factCalls, 0)
  doc = docOf('/test.ts', 'R1[]')
  request({ textDocument: { uri: 'file:///test.ts' }, position: { line: 0, character: 3 } })
  assert.equal(programCalls, 1, 'an eligible syntactic accessor proceeds to semantic resolution')
})
