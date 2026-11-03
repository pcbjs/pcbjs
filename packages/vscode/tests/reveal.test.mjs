import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { vscode, tabGroups, layout, group, setGroups } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { reveal } = require('../dist/reveal.cjs')

const FILE = '/work/demo/blinky.pcb.tsx'
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
  const code = group('/work/demo/pinned.ts'), pane = group('pane')
  setGroups([code, pane], 1)
  await reveal(doc, sel, deps(undefined), false)
  assert.equal(code.activeTab.isPreview, true)
  const next = { uri: vscode.Uri.file('/work/demo/next.ts') }
  await reveal(next, sel, deps(undefined), false)
  assert.deepEqual(files(code), ['/work/demo/pinned.ts', '/work/demo/next.ts'])
  assert.equal(code.activeTab.isPreview, true)
  await reveal({ uri: vscode.Uri.file('/work/demo/pinned.ts') }, sel, deps(undefined), false)
  assert.equal(code.activeTab.isPreview, false, 'a user-pinned tab stays pinned')
  await reveal({ ...doc, isDirty: true }, sel, deps(undefined), false)
  assert.equal(code.activeTab.isPreview, false, 'an edited source stays open')
  await reveal(next, sel, deps(undefined), false)
  assert.ok(files(code).includes(FILE))
  assert.ok(layout.shows.every(opts => opts.preview === true), 'navigation requests native temporary mode')
  assert.equal(tabGroups.activeTabGroup, pane)
})

test('another group takes the file, preferring the one that shows it, then the last used', async () => {
  const code = group('/work/demo/a.ts')
  const shows = group('/work/demo/b.ts', FILE, '/work/demo/c.ts')
  const pane = group('pane')
  setGroups([code, shows, pane], 2)
  const ed = await reveal(doc, sel, deps(undefined, 1))
  assert.equal(ed.viewColumn, 2)
  assert.equal(ed.selection, sel)
  assert.equal(ed.revealed, sel)
  assert.deepEqual(files(pane), ['pane'])
  assert.ok(!layout.calls.some(([c]) => c.startsWith('workbench.')))

  setGroups([group('/work/demo/a.ts'), group('/work/demo/b.ts'), group('pane')], 2)
  assert.equal((await reveal(doc, sel, deps(undefined, 2))).viewColumn, 2)
})

test('a new source tab prefers an ordinary editor group over another preview group', async () => {
  const code = group('/work/demo/a.ts')
  setGroups([code, group('pane'), group('pane')], 1)
  assert.equal((await reveal(doc, sel, deps(undefined, 2))).viewColumn, 1)
})

test('an inactive preview group can open a new source tab before creating a split', async () => {
  const other = group('pane'), clicked = group('pane')
  setGroups([other, clicked], 1)
  const ed = await reveal(doc, sel, deps(undefined), false)
  assert.equal(ed.viewColumn, 1)
  assert.deepEqual(layout.calls, [['show', 1, true]])
  assert.deepEqual(files(clicked), ['pane'])
  assert.equal(tabGroups.activeTabGroup, clicked)
})

test('reuse a hidden source tab behind another preview before opening in an ordinary source group', async () => {
  const code = group('/work/demo/notes.ts')
  const existing = group(FILE, 'pane')
  const clicked = group('pane')
  setGroups([code, existing, clicked], 2)
  const tab = existing.tabs[0]
  const ed = await reveal(doc, sel, deps(undefined, 1), false)
  assert.equal(ed.viewColumn, 2)
  assert.equal(existing.activeTab, tab, 'the existing tab is activated')
  assert.deepEqual(layout.calls, [['show', 2, true]], 'no new group or source tab migration')
  assert.deepEqual(files(code), ['/work/demo/notes.ts'])
  assert.deepEqual(files(existing), [FILE, 'pane'])
  assert.equal(tabGroups.activeTabGroup, clicked, 'the clicked preview retains focus')
  assert.deepEqual(files(clicked), ['pane'])
})

test('an existing source tab is reused without closing another user-opened copy behind the active preview', async () => {
  const existing = group(FILE, '/work/demo/other.ts')
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
  const code = group('/work/demo/other.ts')
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
  const code = group('/work/demo/a.ts')
  const pane = group(FILE, 'pane')
  setGroups([code, pane], 1)
  await reveal(doc, sel, deps(undefined))
  assert.deepEqual(layout.calls, [
    ['show', 1, true],
    ['close', FILE],
    ['show', 1, false],
  ])
  assert.deepEqual(files(pane), ['pane'])
  assert.deepEqual(files(code), ['/work/demo/a.ts', FILE])
})
