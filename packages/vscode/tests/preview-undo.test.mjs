// A click in a pane shows the source with the cursor there while the pane keeps focus, and cmd or ctrl+Z in a pane runs the editor's
// undo, or redo, on the document its edit went through, the pane taking focus back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { vscode, panels, layout, group, setGroups, tabGroups, commands, openDoc } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { Preview } = require('../dist/preview.cjs')
const { reveal } = require('../dist/reveal.cjs')

const server = () => ({
  root: '/work/demo',
  name: 'demo',
  active: true,
  state: { kind: 'running', url: 'http://127.0.0.1:5301/' },
  boards: { boards: [{ name: 'Blinky', title: 'Blinky', entry: 'blinky.pcb.tsx' }], root: '/work/demo' },
  scope: undefined,
  page: undefined,
  recent: () => [],
})
const preview = () => new Preview({ ensureStarted: async () => {}, board: () => undefined, onChange: () => {}, icon: { light: 'l.svg', dark: 'd.svg' } })
const until = async fn => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise(r => setTimeout(r, 5))
  assert.ok(fn())
}

test('a reveal without focus selects the range beside the pane and leaves focus where it was', async () => {
  layout.calls = []
  const pane = group('pane')
  setGroups([group('/work/demo/a.ts'), pane], 1)
  const sel = new vscode.Selection({ line: 4, character: 2 }, { line: 4, character: 9 })
  const ed = await reveal({ uri: vscode.Uri.file('/work/demo/blinky.pcb.tsx') }, sel, { last: () => 1, size: () => undefined }, false)
  assert.deepEqual(layout.calls, [['show', 1, true]])
  assert.equal(ed.selection, sel, 'the cursor is on the placement')
  assert.equal(ed.revealed, sel)
  assert.equal(tabGroups.activeTabGroup, pane, 'the pane keeps focus')
})

test('keepFocus gives the focused pane its focus back after a reveal took it', async () => {
  panels.length = 0
  setGroups([group('/work/demo/a.ts')], 0)
  const p = preview()
  await p.open(server(), '2d')
  const panel = panels[0]
  panel.focus()
  const got = await p.keepFocus(async () => {
    panel.active = false
    return 7
  })
  assert.equal(got, 7)
  assert.equal(panel.active, true)
})

test('cmd or ctrl+Z in a pane undoes the edit in its document through the editor, shift redoes it, the pane keeps focus', async () => {
  panels.length = 0
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-undo-'))
  const file = join(dir, 'pcb.tsx')
  const text = '<R1 at="5 10" />\n'
  writeFileSync(file, text)
  setGroups([group(file)], 0)
  const { doc } = openDoc(file, text)
  const p = preview()
  await p.open(server(), '2d')
  const panel = panels[0]
  panel.focus()
  // the session's write of a drag, through the extension's applyEdit
  const edit = new vscode.WorkspaceEdit()
  edit.replace(vscode.Uri.file(file), new vscode.Range(0, 8, 0, 12), '7 10')
  await vscode.workspace.applyEdit(edit)
  assert.equal(doc.text, '<R1 at="7 10" />\n')

  commands.length = 0
  layout.calls = []
  panel.webview.receive({ type: 'undo', files: [file] })
  await until(() => doc.text === text)
  assert.deepEqual(layout.calls.slice(0, 3), [['show', 1, false], ['workbench.action.focusActiveEditorGroup'], ['undo']], 'the document is shown and focused, then undo runs in it')
  await until(() => panel.active)

  panel.webview.receive({ type: 'undo', files: [file], redo: true })
  await until(() => doc.text === '<R1 at="7 10" />\n')
  assert.ok(commands.some(c => c[0] === 'redo'))
  await until(() => panel.active)
  panel.webview.receive({ type: 'undo', file })
  await new Promise(r => setTimeout(r, 20))
  assert.equal(doc.text, '<R1 at="7 10" />\n', 'the old one-file message is not taken')
})

test('the pane page hands the viewer’s undo to the extension', async () => {
  panels.length = 0
  const p = preview()
  await p.open(server(), '2d')
  const html = panels[0].webview.html
  assert.match(html, /m\.type === 'pcbjs:undo' && Array\.isArray\(m\.files\)\) vscode\.postMessage\(\{ type: 'undo', files: m\.files, redo: !!m\.redo, board: m\.board, project: m\.project \}\)/)
  assert.ok(html.indexOf("'pcbjs:undo'") < html.indexOf('return;'), 'read before the frame’s messages return')
})


test('pane undo uses source chronology after editor and other-pane changes, and redo restores that change', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-chronology-'))
  const file = join(dir, 'pcb.tsx')
  writeFileSync(file, '0')
  const { doc } = openDoc(file, '0')
  const activeEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor')
  Object.defineProperty(vscode.window, 'activeTextEditor', { configurable: true, get: () => ({ document: doc }) })
  t.after(() => Object.defineProperty(vscode.window, 'activeTextEditor', activeEditor))
  setGroups([group(file)], 0)
  const p = preview()
  await p.open(server(), '2d')
  await p.open(server(), '3d', 'new')
  const { undoIn } = require('../dist/preview.cjs')
  for (const value of ['1', '2', '3']) {
    const edit = new vscode.WorkspaceEdit()
    edit.replace(doc.uri, new vscode.Range(0, 0, 0, 1), value)
    await vscode.workspace.applyEdit(edit)
  }
  await undoIn([file], panels.at(-2), false)
  assert.equal(doc.text, '2', 'later source/other-pane edit is the latest native history entry')
  await undoIn([file], panels.at(-1), true)
  assert.equal(doc.text, '3')
  const before = commands.length
  await undoIn([file, join(dir, 'patches.ts')], panels.at(-1), false)
  assert.equal(doc.text, '3')
  assert.equal(commands.length, before, 'no partial multi-document undo')
})

test('pane native undo explicitly focuses the source group before dispatching the generic command', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-native-focus-'))
  const file = join(dir, 'pcb.tsx')
  writeFileSync(file, '0')
  const { doc } = openDoc(file, '0')
  const activeEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor')
  Object.defineProperty(vscode.window, 'activeTextEditor', { configurable: true, get: () => ({ document: doc }) })
  t.after(() => Object.defineProperty(vscode.window, 'activeTextEditor', activeEditor))
  setGroups([group(file)], 0)
  const p = preview()
  await p.open(server(), '2d')
  const panel = panels.at(-1)
  panel.focus()
  const edit = new vscode.WorkspaceEdit()
  edit.replace(doc.uri, new vscode.Range(0, 0, 0, 1), '1')
  await vscode.workspace.applyEdit(edit)
  const original = vscode.commands.executeCommand
  const active = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor')
  let textFocus = false
  const calls = []
  Object.defineProperty(vscode.window, 'activeTextEditor', { configurable: true, get: () => ({ document: doc }) })
  vscode.commands.executeCommand = async (id, ...args) => {
    calls.push(id)
    if (id === 'workbench.action.focusActiveEditorGroup') textFocus = true
    // Native showTextDocument can finish before the focused webview has yielded text focus.
    if ((id === 'undo' || id === 'redo') && !textFocus) return
    return original(id, ...args)
  }
  try {
    const { undoIn } = require('../dist/preview.cjs')
    await undoIn([file], panel, false)
    assert.equal(doc.text, '0')
    assert.deepEqual(calls, ['workbench.action.focusActiveEditorGroup', 'undo'])
    textFocus = false
    calls.length = 0
    await undoIn([file], panel, true)
    assert.equal(doc.text, '1')
    assert.deepEqual(calls, ['workbench.action.focusActiveEditorGroup', 'redo'])
    assert.equal(panel.active, true)
    calls.length = 0
    vscode.commands.executeCommand = async (id, ...args) => {
      calls.push(id)
      if (id === 'workbench.action.focusActiveEditorGroup') setGroups([group('/other/pcb.tsx')], 0)
      return original(id, ...args)
    }
    await undoIn([file], panel, false)
    assert.deepEqual(calls, ['workbench.action.focusActiveEditorGroup'], 'a changed native target refuses undo')
    assert.equal(doc.text, '1')
  } finally {
    vscode.commands.executeCommand = original
    Object.defineProperty(vscode.window, 'activeTextEditor', active)
  }
})

test('source owner is shared by board panes, survives page reload and preserves multi-file refusal', async t => {
  panels.length = 0
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-owner-'))
  const file = join(dir, 'placements.tsx')
  writeFileSync(file, '0')
  const { doc } = openDoc(file, '0')
  const activeEditor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor')
  Object.defineProperty(vscode.window, 'activeTextEditor', { configurable: true, get: () => ({ document: doc }) })
  t.after(() => Object.defineProperty(vscode.window, 'activeTextEditor', activeEditor))
  setGroups([group(file)], 0)
  const p = preview(), s = server()
  s.root = dir
  await p.open(s, '2d')
  await p.open(s, '3d', 'new')
  const [a, b] = panels
  a.webview.receive({ type: 'edit-written', board: 'Blinky', project: dir, files: ['placements.tsx'] })
  const edit = new vscode.WorkspaceEdit()
  edit.replace(doc.uri, new vscode.Range(0, 0, 0, 1), '1')
  await vscode.workspace.applyEdit(edit)
  await p.reload(s)
  b.webview.receive({ type: 'undo', board: 'Blinky', project: dir, files: ['blinky.pcb.tsx'] })
  await until(() => doc.text === '0')
  a.webview.receive({ type: 'edit-written', board: 'Blinky', project: dir, files: ['placements.tsx', 'other.tsx'] })
  const before = commands.length
  b.webview.receive({ type: 'undo', board: 'Blinky', files: ['blinky.pcb.tsx'] })
  await new Promise(r => setTimeout(r, 20))
  assert.equal(commands.length, before, 'ambiguous source ownership cannot fall back to an unrelated entry')
  p.dispose()
})

test('late source ownership and undo from a different board or project are ignored', async () => {
  panels.length = 0
  setGroups([group('/work/demo/a.ts')], 0)
  const p = preview(), s = server()
  await p.open(s, '2d')
  const panel = panels[0]
  const before = commands.length
  panel.webview.receive({ type: 'edit-written', board: 'Other', files: ['/unrelated.tsx'] })
  panel.webview.receive({ type: 'undo', board: 'Other', files: ['/unrelated.tsx'] })
  panel.webview.receive({ type: 'undo', board: 'Blinky', project: '/different', files: ['/unrelated.tsx'] })
  await new Promise(r => setTimeout(r, 20))
  assert.equal(commands.length, before)
  p.dispose()
})

test('rapid keyboard requests across panes serialize native source focus and undo', async t => {
  panels.length = 0
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-undo-queue-')), file = join(dir, 'pcb.tsx')
  writeFileSync(file, '0')
  const { doc } = openDoc(file, '0')
  const active = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor')
  Object.defineProperty(vscode.window, 'activeTextEditor', { configurable: true, get: () => ({ document: doc }) })
  const original = vscode.commands.executeCommand
  let release, entered = 0
  const gate = new Promise(resolve => { release = resolve })
  vscode.commands.executeCommand = async (id, ...args) => {
    if (id === 'undo' && ++entered === 1) await gate
    return original(id, ...args)
  }
  t.after(() => {
    vscode.commands.executeCommand = original
    Object.defineProperty(vscode.window, 'activeTextEditor', active)
  })
  setGroups([group(file)], 0)
  const p = preview(), s = server()
  await p.open(s, '2d')
  await p.open(s, '3d', 'new')
  for (const value of ['1', '2']) {
    const edit = new vscode.WorkspaceEdit()
    edit.replace(doc.uri, new vscode.Range(0, 0, 0, 1), value)
    await vscode.workspace.applyEdit(edit)
  }
  panels[0].webview.receive({ type: 'undo', files: [file] })
  panels[1].webview.receive({ type: 'undo', files: [file] })
  await until(() => entered === 1)
  assert.equal(doc.text, '2')
  release()
  await until(() => doc.text === '0')
  assert.equal(entered, 2)
  p.dispose()
})
