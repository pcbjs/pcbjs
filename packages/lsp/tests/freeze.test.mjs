// The code action that freezes auto placement: offered on the line of a part with an auto slot, it writes the placed `at` through the editor.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dev } from './fixtures/dev.mjs'
import { makeProject } from './fixtures/project.mjs'
import { applyEdits, initParams, posOf, sessionClient, waitFor } from './fixtures/client.mjs'

const BOARD = `import PCB, { defineFootprint, nets, type FootprintProps } from '@pcbjs/core'

const TestPad = defineFootprint(function TestPad(props: FootprintProps) {
  return <footprint value="V" id="pcbjs:TestPad" bom={false} {...props}><pad num={1} size={2} shape="circle" /></footprint>
}, { pins: ['1'], prefix: 'TP' })
const { V } = nets()
const TP1 = TestPad().connect({ 1: V })
const TP2 = TestPad().connect({ 1: V })

export default (
  <PCB name="Fix">
    <path layer="Edge.Cuts" d="M 0 0 H 30 V 20 H 0 Z" />
    <TP1 at="5 10" />
    <TP2 at="auto 10" at:initial="25 10" />
  </PCB>
)
`

let project, server, client, uri, text
const diagnostics = []

before(async () => {
  project = makeProject(BOARD)
  server = await dev({ root: project.root, port: 0, host: '127.0.0.1' })
  client = await sessionClient(server.httpServer.address().port)
  uri = pathToFileURL(project.main).href
  text = readFileSync(project.main, 'utf8')
  client.conn.onNotification('textDocument/publishDiagnostics', p => diagnostics.push(p))
})

after(async () => {
  client?.close()
  await server?.close()
  if (project) rmSync(project.root, { recursive: true, force: true })
})

test('code action: Freeze the auto placement on the line of an auto part, none on a fixed one', { timeout: 60000 }, async () => {
  await client.conn.sendRequest('initialize', initParams(project.root))
  await client.conn.sendNotification('initialized', {})
  const got = waitFor(h => {
    const t = setInterval(() => {
      if (diagnostics.some(d => d.uri === uri)) {
        clearInterval(t)
        h(true)
      }
    }, 50)
  })
  await client.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
  await client.conn.sendNotification('pcbjs/focus', { textDocument: { uri }, position: posOf(text, '<TP2') })
  await got
  const at = needle => {
    const p = posOf(text, needle)
    return { textDocument: { uri }, range: { start: p, end: p }, context: { diagnostics: [] } }
  }
  const actions = await waitFor(
    h => {
      const t = setInterval(async () => {
        const a = await client.conn.sendRequest('textDocument/codeAction', at('<TP2'))
        if (a.some(x => x.kind === 'refactor.rewrite')) {
          clearInterval(t)
          h(a)
        }
      }, 100)
    },
    () => true,
  )
  const freeze = actions.find(x => x.kind === 'refactor.rewrite')
  assert.equal(freeze.title, 'Freeze the auto placement of this file')
  const after = applyEdits(text, freeze.edit.changes[uri])
  assert.match(after, /<TP2 at="[\d.]+ 10" \/>/)
  assert.doesNotMatch(after, /at:initial/)
  const fixed = await client.conn.sendRequest('textDocument/codeAction', at('<TP1'))
  assert.equal(
    fixed.some(x => x.kind === 'refactor.rewrite'),
    false,
  )
})
