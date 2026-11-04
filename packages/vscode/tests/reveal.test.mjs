import { resolve as fixturePath } from 'node:path'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { vscode, tabGroups, layout, group, setGroups } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { reveal } = require('../dist/reveal.cjs')

const FILE = fixturePath('/work/demo/blinky.pcb.tsx')
const doc = { uri: vscode.Uri.file(FILE) }
const sel = new vscode.Selection({ line: 4, character: 2 }, { line: 4, character: 9 })
const deps = (size, last) => ({ last: () => last, size: () => size })
const files = g => g.tabs.map(t => t.input.uri?.fsPath ?? 'pane')

beforeEach(() => {
  layout.calls = []
  layout.shows = []
  layout.orientation = 0
})

test('successive source navigation replaces temporary tabs while preserving pinned and edited documents', async () => {
  const code = group(fixturePath('/work/demo/pinned.ts')),
    pane = group('pane')
  setGroups([code, pane], 1)
  await reveal(doc, sel, deps(undefined), false)
  assert.equal(code.activeTab.isPreview, true)
  const next = { uri: vscode.Uri.file(fixturePath('/work/demo/next.ts')) }
  await reveal(next, sel, deps(undefined), false)
  assert.deepEqual(files(code), [fixturePath('/work/demo/pinned.ts'), fixturePath('/work/demo/next.ts')])
  assert.equal(code.activeTab.isPreview, true)
  await reveal({ uri: vscode.Uri.file(fixturePath('/work/demo/pinned.ts')) }, sel, deps(undefined), false)
  assert.equal(code.activeTab.isPreview, false, 'a user-pinned tab stays pinned')
  await reveal({ ...doc, isDirty: true }, sel, deps(undefined), false)
  assert.equal(code.activeTab.isPreview, false, 'an edited source stays open')
  await reveal(next, sel, deps(undefined), false)
  assert.ok(files(code).includes(FILE))
  assert.ok(
    layout.shows.every(opts => opts.preview === true),
    'navigation requests native temporary mode',
  )
  assert.equal(tabGroups.activeTabGroup, pane)
})

test('another group takes the file, preferring the one that shows it, then the last used', async () => {
  const code = group(fixturePath('/work/demo/a.ts'))
  const shows = group(fixturePath('/work/demo/b.ts'), FILE, fixturePath('/work/demo/c.ts'))
  const pane = group('pane')
  setGroups([code, shows, pane], 2)
  const ed = await reveal(doc, sel, deps(undefined, 1))
  assert.equal(ed.viewColumn, 2)
  assert.equal(ed.selection, sel)
  assert.equal(ed.revealed, sel)
  assert.deepEqual(files(pane), ['pane'])
  assert.ok(!layout.calls.some(([c]) => c.startsWith('workbench.')))

  setGroups([group(fixturePath('/work/demo/a.ts')), group(fixturePath('/work/demo/b.ts')), group('pane')], 2)
  assert.equal((await reveal(doc, sel, deps(undefined, 2))).viewColumn, 2)
})

test('a new source tab prefers an ordinary editor group over another preview group', async () => {
  const code = group(fixturePath('/work/demo/a.ts'))
  setGroups([code, group('pane'), group('pane')], 1)
  assert.equal((await reveal(doc, sel, deps(undefined, 2))).viewColumn, 1)
})

test('an inactive preview group can open a new source tab before creating a split', async () => {
  const other = group('pane'),
    clicked = group('pane')
  setGroups([other, clicked], 1)
  const ed = await reveal(doc, sel, deps(undefined), false)
  assert.equal(ed.viewColumn, 1)
  assert.deepEqual(layout.calls, [['show', 1, true]])
  assert.deepEqual(files(clicked), ['pane'])
  assert.equal(tabGroups.activeTabGroup, clicked)
})

test('reuse a hidden source tab behind another preview before opening in an ordinary source group', async () => {
  const code = group(fixturePath('/work/demo/notes.ts'))
  const existing = group(FILE, 'pane')
  const clicked = group('pane')
  setGroups([code, existing, clicked], 2)
  const tab = existing.tabs[0]
  const ed = await reveal(doc, sel, deps(undefined, 1), false)
  assert.equal(ed.viewColumn, 2)
  assert.equal(existing.activeTab, tab, 'the existing tab is activated')
  assert.deepEqual(layout.calls, [['show', 2, true]], 'no new group or source tab migration')
  assert.deepEqual(files(code), [fixturePath('/work/demo/notes.ts')])
  assert.deepEqual(files(existing), [FILE, 'pane'])
  assert.equal(tabGroups.activeTabGroup, clicked, 'the clicked preview retains focus')
  assert.deepEqual(files(clicked), ['pane'])
})

test('an existing source tab is reused without closing another user-opened copy behind the active preview', async () => {
  const existing = group(FILE, fixturePath('/work/demo/other.ts'))
  const clicked = group(FILE, 'pane')
  setGroups([existing, clicked], 1)
  const tab = existing.tabs[0]
  const ed = await reveal(doc, sel, deps(undefined), false)
  assert.equal(ed.viewColumn, 1)
  assert.equal(existing.activeTab, tab)
  assert.deepEqual(layout.calls, [['show', 1, true]])
  assert.deepEqual(files(clicked), [FILE, 'pane'])
})

test('without an active preview, a source tab behind an inactive preview remains eligible', async () => {
  const existing = group(FILE, 'pane')
  const code = group(fixturePath('/work/demo/other.ts'))
  setGroups([existing, code], 1)
  const tab = existing.tabs[0]
  const ed = await reveal(doc, sel, deps(undefined, 2))
  assert.equal(ed.viewColumn, 1)
  assert.equal(existing.activeTab, tab)
  assert.deepEqual(layout.calls, [['show', 1, false]])
  assert.deepEqual(files(existing), [FILE, 'pane'])
})

test('the only group, wider than tall: a new group to the left', async () => {
  const pane = group('pane')
  setGroups([pane], 0)
  const ed = await reveal(doc, sel, deps({ w: 1600, h: 900 }))
  assert.deepEqual(layout.calls[0], ['workbench.action.newGroupLeft'])
  assert.equal(ed.viewColumn, 1)
  assert.equal(pane.viewColumn, 2)
  assert.deepEqual(files(pane), ['pane'])
  assert.equal(tabGroups.activeTabGroup, tabGroups.all[0])
})

test('the only group, taller than wide: a new group above', async () => {
  setGroups([group('pane')], 0)
  const ed = await reveal(doc, sel, deps({ w: 700, h: 1200 }))
  assert.deepEqual(layout.calls[0], ['workbench.action.newGroupAbove'])
  assert.equal(ed.viewColumn, 1)
})

test('no size: the layout orientation decides, else left', async () => {
  layout.orientation = 1
  setGroups([group('pane')], 0)
  await reveal(doc, sel, deps(undefined))
  assert.deepEqual(layout.calls.slice(0, 2), [['vscode.getEditorLayout'], ['workbench.action.newGroupAbove']])
  layout.calls = []
  layout.orientation = 0
  setGroups([group('pane')], 0)
  await reveal(doc, sel, deps(undefined))
  assert.deepEqual(layout.calls[1], ['workbench.action.newGroupLeft'])
})

test('the file open behind the preview moves to the target group before it takes focus', async () => {
  const pane = group(FILE, 'pane')
  setGroups([pane], 0)
  const ed = await reveal(doc, sel, deps({ w: 1600, h: 900 }))
  assert.deepEqual(layout.calls, [['workbench.action.newGroupLeft'], ['show', 1, true], ['close', FILE], ['show', 1, false]])
  assert.equal(ed.viewColumn, 1)
  assert.deepEqual(files(pane), ['pane'])
  assert.equal(pane.activeTab.input.viewType, 'mainThreadWebview-pcbjs.preview')
  assert.deepEqual(files(tabGroups.all[0]), [FILE])
})

test('the same move when another group exists', async () => {
  const code = group(fixturePath('/work/demo/a.ts'))
  const pane = group(FILE, 'pane')
  setGroups([code, pane], 1)
  await reveal(doc, sel, deps(undefined))
  assert.deepEqual(layout.calls, [
    ['show', 1, true],
    ['close', FILE],
    ['show', 1, false],
  ])
  assert.deepEqual(files(pane), ['pane'])
  assert.deepEqual(files(code), [fixturePath('/work/demo/a.ts'), FILE])
})

test('delayed source selection cannot cover its originating preview after focus changes', async () => {
  const { showSelect } = require('../dist/reveal.cjs')
  const clicked = group('pane'),
    other = group('pane')
  setGroups([clicked, other], 0)
  const original = vscode.workspace.openTextDocument
  let complete
  vscode.workspace.openTextDocument = () =>
    new Promise(resolve => {
      complete = resolve
    })
  try {
    const uri = vscode.Uri.file(FILE).toString()
    const at = { line: 0, character: 0 }
    const pending = showSelect({ primary: { uri, index: 0 }, items: [{ uri, ranges: [{ start: at, end: at }] }], reveal: true }, deps(), show => show())
    tabGroups.activeTabGroup = other
    complete({ uri: vscode.Uri.file(FILE), validatePosition: p => p })
    assert.equal(await pending, undefined)
    assert.deepEqual(layout.calls, [])
    assert.ok(clicked.activeTab.input instanceof vscode.TabInputWebview)
    assert.equal(tabGroups.activeTabGroup, other)
  } finally {
    vscode.workspace.openTextDocument = original
  }
})

test('a newer selection supersedes an older document open', async () => {
  const { showSelect } = require('../dist/reveal.cjs')
  const code = group(),
    pane = group('pane')
  setGroups([code, pane], 1)
  const original = vscode.workspace.openTextDocument
  const pending = []
  vscode.workspace.openTextDocument = uri => new Promise(resolve => pending.push(() => resolve({ uri, validatePosition: p => p })))
  try {
    const select = file => {
      const uri = vscode.Uri.file(file).toString(),
        at = { line: 0, character: 0 }
      return showSelect({ primary: { uri, index: 0 }, items: [{ uri, ranges: [{ start: at, end: at }] }], reveal: true }, deps(), show => show())
    }
    const a = select(FILE),
      b = select(fixturePath('/work/demo/new.tsx'))
    pending[1]()
    await b
    pending[0]()
    assert.equal(await a, undefined)
    assert.equal(code.activeTab.input.uri.fsPath, fixturePath('/work/demo/new.tsx'))
  } finally {
    vscode.workspace.openTextDocument = original
  }
})

const turn = () => new Promise(resolve => setImmediate(resolve))
const selectFile = file => {
  const uri = vscode.Uri.file(file).toString(),
    at = { line: 0, character: 0 }
  return { primary: { uri, index: 0 }, items: [{ uri, ranges: [{ start: at, end: at }] }], reveal: true }
}

test('layout lookup cannot split a newly focused group or cover the originating preview', async () => {
  const { showSelect } = require('../dist/reveal.cjs')
  const clicked = group('pane'),
    other = group('pane')
  setGroups([clicked], 0)
  const open = vscode.workspace.openTextDocument,
    command = vscode.commands.executeCommand
  let release
  vscode.workspace.openTextDocument = async uri => ({ uri, validatePosition: p => p })
  vscode.commands.executeCommand = (id, ...args) => (id === 'vscode.getEditorLayout' ? new Promise(resolve => (release = resolve)) : command(id, ...args))
  try {
    const pending = showSelect(selectFile(FILE), deps(), show => show())
    await turn()
    setGroups([clicked, other], 1)
    release({ orientation: 0 })
    assert.equal(await pending, undefined)
    assert.deepEqual(layout.calls, [])
    assert.deepEqual(files(clicked), ['pane'])
    assert.equal(tabGroups.activeTabGroup, other)
  } finally {
    vscode.workspace.openTextDocument = open
    vscode.commands.executeCommand = command
  }
})

for (const focus of [false, true])
  test(`an older delayed host reveal settles before the latest request opens its source, focus=${focus}`, async () => {
    const { showSelect } = require('../dist/reveal.cjs')
    const code = group(),
      pane = group('pane')
    setGroups([code, pane], 1)
    const open = vscode.workspace.openTextDocument,
      show = vscode.window.showTextDocument
    let release, oldEditor
    vscode.workspace.openTextDocument = async uri => ({ uri, validatePosition: p => p })
    vscode.window.showTextDocument = async (doc, opts) => {
      if (doc.uri.fsPath === FILE) {
        await new Promise(resolve => (release = resolve))
        return (oldEditor = await show(doc, opts))
      }
      return show(doc, opts)
    }
    try {
      const older = showSelect({ ...selectFile(FILE), focus }, deps(), show => show())
      await turn()
      const newer = showSelect({ ...selectFile(fixturePath('/work/demo/new.tsx')), focus }, deps(), show => show())
      await turn()
      assert.equal(layout.calls.length, 0, 'uncancellable host operations do not overlap')
      release()
      assert.equal(await older, undefined)
      assert.ok(await newer)
      assert.equal(oldEditor.selection, undefined, 'superseded completion does not move the caret')
      assert.equal(code.activeTab.input.uri.fsPath, fixturePath('/work/demo/new.tsx'))
      assert.deepEqual(files(pane), ['pane'])
    } finally {
      vscode.workspace.openTextDocument = open
      vscode.window.showTextDocument = show
    }
  })

test('user focus changes during source movement cancel remaining close and reveal operations', async () => {
  const { showSelect } = require('../dist/reveal.cjs')
  const code = group(),
    pane = group(FILE, 'pane'),
    other = group('pane')
  setGroups([code, pane, other], 1)
  const open = vscode.workspace.openTextDocument,
    show = vscode.window.showTextDocument
  let release,
    restored = false
  vscode.workspace.openTextDocument = async uri => ({ uri, validatePosition: p => p })
  vscode.window.showTextDocument = async (doc, opts) => {
    await new Promise(resolve => (release = resolve))
    return show(doc, opts)
  }
  try {
    const pending = showSelect(selectFile(FILE), deps(), async (fn, valid) => {
      const value = await fn()
      restored = valid()
      return value
    })
    await turn()
    tabGroups.activeTabGroup = other
    release()
    assert.equal(await pending, undefined)
    assert.equal(restored, false, 'focus restoration must not steal user focus')
    assert.deepEqual(files(pane), [FILE, 'pane'], 'the source tab is not closed after cancellation')
    assert.equal(layout.calls.length, 1, 'only the already-running host call finishes')
  } finally {
    vscode.workspace.openTextDocument = open
    vscode.window.showTextDocument = show
  }
})

test('latest request survives an older host focus change while its document is still opening', async () => {
  const { showSelect } = require('../dist/reveal.cjs')
  const code = group(),
    pane = group('pane')
  setGroups([code, pane], 1)
  const open = vscode.workspace.openTextDocument,
    show = vscode.window.showTextDocument
  let releaseShow, releaseOpen
  vscode.workspace.openTextDocument = async uri => {
    if (uri.fsPath !== FILE) await new Promise(resolve => (releaseOpen = resolve))
    return { uri, validatePosition: p => p }
  }
  vscode.window.showTextDocument = async (doc, opts) => {
    if (doc.uri.fsPath === FILE) await new Promise(resolve => (releaseShow = resolve))
    return show(doc, opts)
  }
  try {
    const older = showSelect({ ...selectFile(FILE), focus: true }, deps(), show => show())
    await turn()
    const newer = showSelect({ ...selectFile(fixturePath('/work/demo/new.tsx')), focus: true }, deps(), show => show())
    releaseShow()
    assert.equal(await older, undefined)
    releaseOpen()
    assert.ok(await newer)
    assert.equal(code.activeTab.input.uri.fsPath, fixturePath('/work/demo/new.tsx'))
    assert.deepEqual(files(pane), ['pane'])
  } finally {
    vscode.workspace.openTextDocument = open
    vscode.window.showTextDocument = show
  }
})

test('empty range lists do not open an editor and failed opens do not block subsequent navigation', async () => {
  const { showSelect } = require('../dist/reveal.cjs')
  const code = group(),
    pane = group('pane')
  setGroups([code, pane], 1)
  const original = vscode.workspace.openTextDocument
  let calls = 0
  vscode.workspace.openTextDocument = async uri => {
    calls++
    throw new Error('missing document')
  }
  try {
    const empty = selectFile(FILE)
    empty.items[0].ranges = []
    assert.equal(await showSelect(empty, deps(), show => show()), undefined)
    assert.equal(calls, 0)
    await assert.rejects(
      showSelect(selectFile(FILE), deps(), show => show()),
      /missing document/,
    )
    vscode.workspace.openTextDocument = async uri => ({ uri, validatePosition: p => p })
    assert.ok(await showSelect(selectFile(FILE), deps(), show => show()))
    assert.deepEqual(files(pane), ['pane'])
  } finally {
    vscode.workspace.openTextDocument = original
  }
})
