import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { vscode } from './vscode.mjs'

const { PadHints } = createRequire(import.meta.url)('../dist/pad-hints.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async fn => {
  for (let n = 0; n < 100 && !fn(); n++) await sleep(5)
  assert.ok(fn())
}
const position = character => ({ line: 0, character, isEqual: p => p.line === 0 && p.character === character })
const editorAt = (text, character) => {
  const p = position(character)
  return {
    document: { uri: vscode.Uri.file('/work/pcb.tsx'), languageId: 'typescriptreact', version: 1, isClosed: false, text },
    selection: { isEmpty: true, active: p },
    selections: [{ isEmpty: true, active: p }],
  }
}

function fixture(t) {
  let active, owner
  const events = {},
    calls = [],
    requests = []
  const descriptors = []
  const patch = (object, key, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    descriptors.push(() => (descriptor ? Object.defineProperty(object, key, descriptor) : delete object[key]))
    Object.defineProperty(object, key, { configurable: true, value })
  }
  const event = name => callback => {
    events[name] = callback
    return {
      dispose() {
        delete events[name]
      },
    }
  }
  const activeDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor')
  Object.defineProperty(vscode.window, 'activeTextEditor', { configurable: true, get: () => active })
  descriptors.push(() => Object.defineProperty(vscode.window, 'activeTextEditor', activeDescriptor))
  patch(vscode.window, 'onDidChangeTextEditorSelection', event('selection'))
  patch(vscode.window, 'onDidChangeActiveTextEditor', event('active'))
  patch(vscode.workspace, 'onDidChangeTextDocument', event('change'))
  patch(vscode.workspace, 'onDidCloseTextDocument', event('close'))
  patch(vscode.commands, 'executeCommand', async (...args) => {
    calls.push(args)
  })
  const session = {
    clearSignature() {},
    signature: async (uri, p) => {
      requests.push({ uri, position: p })
      return true
    },
  }
  owner = session
  const hints = new PadHints(() => owner)
  t.after(() => {
    hints.dispose()
    descriptors.reverse().forEach(restore => restore())
  })
  return {
    calls,
    requests,
    events,
    hints,
    session,
    setActive(e) {
      active = e
      events.active(e)
    },
    owner(s) {
      owner = s
    },
    move(character) {
      const p = position(character)
      active.selection = { isEmpty: true, active: p }
      active.selections = [active.selection]
      events.selection({ textEditor: active })
    },
  }
}

test('typing a pad bracket or moving into an existing index automatically triggers native hints without changing editor or text', async t => {
  const f = fixture(t),
    e = editorAt('R1[', 3)
  f.setActive(e)
  await until(() => f.calls.length === 1)
  assert.deepEqual(f.calls, [['editor.action.triggerParameterHints']])
  assert.equal(vscode.window.activeTextEditor, e)
  assert.equal(e.document.text, 'R1[')
  assert.equal(e.selection.active.character, 3)
  f.events.selection({ textEditor: e })
  await sleep(30)
  assert.equal(f.calls.length, 1, 'duplicate typing and caret events do not reopen the widget')
  for (const [text, at] of [
    ['R1[12]', 4],
    ["R1['1']", 5],
    ['R1["', 4],
  ]) {
    e.document.text = text
    ++e.document.version
    f.move(at)
    await until(() => f.requests.at(-1)?.position.character === at && f.calls.length > 1)
    await sleep(25)
    assert.equal(e.document.text, text)
    assert.equal(e.selection.active.character, at)
  }
})

test('semantic ineligibility dismisses owned pad hints but does not dismiss unrelated TypeScript hints', async t => {
  const f = fixture(t),
    e = editorAt('array[0]', 7)
  f.session.signature = async () => false
  f.setActive(e)
  await sleep(35)
  assert.deepEqual(f.calls, [])
  f.session.signature = async () => true
  f.move(3)
  await until(() => f.calls.length === 1)
  f.session.signature = async () => false
  f.move(8)
  await until(() => f.calls.length === 2)
  assert.deepEqual(f.calls[1], ['closeParameterHints'])
  f.move(0)
  await sleep(30)
  assert.equal(f.calls.length, 2)
})

test('leaving the source, selecting text and losing ownership close hints without stealing focus', async t => {
  const f = fixture(t),
    e = editorAt('R1[1]', 4)
  f.setActive(e)
  await until(() => f.calls.length === 1)
  f.setActive(undefined)
  assert.equal(f.calls.length, 1, 'blur does not dispatch at a different active editor')
  assert.equal(vscode.window.activeTextEditor, undefined)
  f.setActive(e)
  await until(() => f.calls.length === 2)
  e.selection.isEmpty = false
  f.events.selection({ textEditor: e })
  assert.deepEqual(f.calls.at(-1), ['closeParameterHints'])
  e.selection.isEmpty = true
  f.hints.refresh()
  await until(() => f.calls.length === 4)
  f.owner(undefined)
  f.hints.refresh()
  assert.deepEqual(f.calls.at(-1), ['closeParameterHints'])
})

test('stale eligibility cannot reopen a hint after caret, version, editor, ownership or disposal changes', async t => {
  const f = fixture(t),
    e = editorAt('R1[1]', 4)
  const pending = []
  f.session.signature = () => new Promise(resolve => pending.push(resolve))
  f.setActive(e)
  await until(() => pending.length === 1)
  f.move(0)
  pending.shift()(true)
  await sleep(5)
  assert.deepEqual(f.calls, [])
  await until(() => pending.length === 1)
  ++e.document.version
  pending.shift()(true)
  await sleep(5)
  assert.deepEqual(f.calls, [])
  f.hints.refresh()
  await until(() => pending.length === 1)
  f.owner({ clearSignature() {}, signature: async () => true })
  pending.shift()(true)
  await sleep(5)
  assert.deepEqual(f.calls, [])
  f.owner(f.session)
  f.hints.refresh()
  await until(() => pending.length === 1)
  f.setActive(editorAt('unrelated', 0))
  pending.shift()(true)
  await sleep(5)
  assert.deepEqual(f.calls, [])
  await until(() => pending.length === 1)
  f.hints.dispose()
  pending.shift()(true)
  await sleep(5)
  assert.deepEqual(f.calls, [])
})

test('server failure and multiple carets produce no hint or source mutation', async t => {
  const f = fixture(t),
    e = editorAt('R1[1]', 4)
  f.session.signature = async () => {
    throw new Error('session disconnected')
  }
  f.setActive(e)
  await sleep(35)
  assert.deepEqual(f.calls, [])
  e.selections.push(e.selection)
  f.hints.refresh()
  await sleep(25)
  assert.deepEqual(f.calls, [])
  assert.equal(e.document.text, 'R1[1]')
})

test('signature eligibility uses standard LSP requests and provider ownership excludes sibling sessions', async () => {
  const { PcbjsSession, ownedMiddleware } = createRequire(import.meta.url)('../dist/lsp-client.cjs')
  const requests = []
  let response = { signatures: [{ label: 'R1[pad]' }] }
  const rpc = {
    onNotification: () => ({ dispose() {} }),
    sendRequest: async (method, params) => {
      requests.push({ method, params })
      return response
    },
  }
  const session = new PcbjsSession(rpc, {})
  assert.equal(await session.signature('file:///work/pcb.tsx', { line: 2, character: 4 }), true)
  assert.deepEqual(requests[0], { method: 'textDocument/signatureHelp', params: { textDocument: { uri: 'file:///work/pcb.tsx' }, position: { line: 2, character: 4 } } })
  response = null
  assert.equal(await session.signature('file:///work/pcb.tsx', { line: 0, character: 0 }), false)
  response = { signatures: [] }
  assert.equal(await session.signature('file:///work/pcb.tsx', { line: 0, character: 0 }), false)
  const middleware = ownedMiddleware(uri => uri === 'file:///work/pcb.tsx')
  let calls = 0
  const next = () => {
    ++calls
    return 'owned'
  }
  assert.equal(middleware.provideSignatureHelp({ uri: 'file:///other/pcb.tsx' }, {}, {}, {}, next), undefined)
  assert.equal(calls, 0)
  assert.equal(middleware.provideSignatureHelp({ uri: 'file:///work/pcb.tsx' }, {}, {}, {}, next), 'owned')
  assert.equal(calls, 1)
  session.dispose()
})

test('reconnected client at the same source version and caret is checked again', async t => {
  const f = fixture(t),
    e = editorAt('R1[1]', 4)
  f.setActive(e)
  await until(() => f.calls.length === 1)
  let queried = 0
  f.owner({
    clearSignature() {},
    signature: async () => {
      ++queried
      return true
    },
  })
  f.hints.refresh()
  await until(() => queried === 1 && f.calls.length === 3)
  assert.deepEqual(f.calls, [['editor.action.triggerParameterHints'], ['closeParameterHints'], ['editor.action.triggerParameterHints']])
  const other = editorAt('f(1)', 2)
  f.setActive(other)
  assert.equal(f.calls.length, 3, 'changing editors does not close the newly active TypeScript widget')
})

test('an older ineligible reply cannot dismiss a newer accepted pad hint', async t => {
  const f = fixture(t),
    e = editorAt('R1[12]', 3),
    pending = []
  f.session.signature = () => new Promise(resolve => pending.push(resolve))
  f.setActive(e)
  await until(() => pending.length === 1)
  f.move(4)
  await until(() => pending.length === 2)
  pending[1](true)
  await until(() => f.calls.length === 1)
  pending[0](false)
  await sleep(10)
  assert.deepEqual(f.calls, [['editor.action.triggerParameterHints']])
})

test('native pad provider consumes the versioned preflight once; stale or failed requests cannot replace it', async () => {
  const { PcbjsSession } = createRequire(import.meta.url)('../dist/lsp-client.cjs')
  const pending = []
  const rpc = { onNotification: () => ({ dispose() {} }), sendRequest: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) }
  const session = new PcbjsSession(rpc, {})
  const uri = 'file:///work/pcb.tsx',
    at = { line: 0, character: 3 }
  const help = { signatures: [{ label: 'R1[pad]' }] }
  const preflight = session.signature(uri, at, 1)
  pending[0].resolve(help)
  assert.equal(await preflight, true)
  assert.equal(await session.takeSignature(uri, at, 1), help)
  assert.equal(pending.length, 1, 'the provider reuses the preflight response')
  assert.equal(session.takeSignature(uri, at, 1), undefined, 'one use, not a persistent result cache')
  for (const [otherUri, otherAt, version] of [
    [uri, at, 2],
    [uri, { line: 0, character: 4 }, 1],
    ['file:///other.tsx', at, 1],
  ]) {
    const p = session.signature(uri, at, 1)
    pending.at(-1).resolve(help)
    await p
    assert.equal(session.takeSignature(otherUri, otherAt, version), undefined)
  }
  const old = session.signature(uri, at, 1)
  const newer = session.signature(uri, at, 2)
  pending.at(-1).resolve(help)
  await newer
  pending.at(-2).resolve(null)
  assert.equal(await old, false)
  assert.equal(await session.takeSignature(uri, at, 2), help, 'late ineligibility cannot erase newer help')
  const failed = session.signature(uri, at, 3)
  pending.at(-1).reject(new Error('disconnected'))
  await assert.rejects(failed, /disconnected/)
  assert.equal(session.takeSignature(uri, at, 3), undefined)
  const last = session.signature(uri, at, 4)
  pending.at(-1).resolve(help)
  await last
  session.dispose()
  assert.equal(session.takeSignature(uri, at, 4), undefined)
})
