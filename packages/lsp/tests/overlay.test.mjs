// An agent whose text the editor's hold refused reads its own program: its hover names the part at the offsets of its own text, while
// the editor's names it at the editor's, through the session's one program.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dev } from './fixtures/dev.mjs'
import { makeProject } from './fixtures/project.mjs'
import { initParams, posOf, sessionClient, waitFor } from './fixtures/client.mjs'

let project, server, editor, agent, uri, text

before(async () => {
  project = makeProject()
  server = await dev({ root: project.root, port: 0, host: '127.0.0.1' })
  const port = server.httpServer.address().port
  uri = pathToFileURL(project.main).href
  text = readFileSync(project.main, 'utf8')
  editor = await sessionClient(port)
  agent = await sessionClient(port, 'agent')
  const published = waitFor(h => editor.conn.onNotification('textDocument/publishDiagnostics', p => p.uri === uri && h(p)))
  for (const c of [editor, agent]) {
    await c.conn.sendRequest('initialize', initParams(project.root))
    await c.conn.sendNotification('initialized', {})
  }
  await editor.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } })
  await published
})

after(async () => {
  editor?.close()
  agent?.close()
  await server?.close()
  if (project) rmSync(project.root, { recursive: true, force: true })
})

/** The hover range of the part handle `TP1` in the route call, from `c` reading `t`. */
async function tp1(c, t) {
  for (let i = 0; i < 100; i++) {
    const h = await c.conn.sendRequest('textDocument/hover', { textDocument: { uri }, position: posOf(t, 'route(TP1', 7) })
    if (h?.range && /TP1/.test(h.contents.value)) return h.range
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('no hover on TP1')
}

test('a refused agent hovers at its own offsets, the editor at its own', async () => {
  const own = `// the agent's draft\n// two lines more\n${text}`
  await agent.conn.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text: own } })
  const want = (t, s = posOf(t, 'route(TP1', 6)) => ({ start: s, end: { line: s.line, character: s.character + 3 } })
  assert.deepEqual(await tp1(agent, own), want(own))
  assert.deepEqual(await tp1(editor, text), want(text))
})
