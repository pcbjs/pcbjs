// The diff3 merge of a disk write under unsaved text, against the fake editor: a clean merge reverts to disk and reapplies the
// user's change with the cursor kept, a conflict opens the merge editor on the three sides; neither drops a side.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { commands, contentProviders, docs, editors, openDoc, ui, vscode } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { merge3, hunks, splitLines } = require('../dist/merge3.cjs')
const { Merger } = require('../dist/merge.cjs')

const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pcbjs-merge-')))
after(() => rmSync(tmp, { recursive: true, force: true }))

const BASE = ['import PCB from "@pcbjs/core"', 'const a = 1', 'const b = 2', 'const c = 3', 'const d = 4', 'export default <PCB />', ''].join('\n')

function reset() {
  docs.length = editors.length = commands.length = 0
  ui.calls.length = 0
}

test('merge3: one side changed takes it, both the same takes it once, different changes to one region conflict', () => {
  const ours = BASE.replace('const b = 2', 'const b = 20')
  const theirs = BASE.replace('const d = 4', 'const d = 40')
  const m = merge3(BASE, ours, theirs)
  assert.equal(m.conflicts, 0)
  assert.equal(m.text, BASE.replace('const b = 2', 'const b = 20').replace('const d = 4', 'const d = 40'))
  assert.equal(merge3(BASE, ours, ours).text, ours)
  assert.equal(merge3(BASE, BASE, theirs).text, theirs)
  const c = merge3(BASE, ours, BASE.replace('const b = 2', 'const b = 7'), { ours: 'yours', theirs: 'claude' })
  assert.equal(c.conflicts, 1)
  assert.match(c.text, /<<<<<<< yours\nconst b = 20\n=======\nconst b = 7\n>>>>>>> claude\n/)
  // an insertion above shifts the lines of ours
  const above = merge3(BASE, ours, '// header\n' + BASE)
  assert.equal(above.lines[2], 3)
  assert.deepEqual(hunks(splitLines('a\nb\n'), splitLines('a\nx\nb\n')), [{ baseStart: 1, baseEnd: 1, start: 1, end: 2 }])
})

test('a clean merge reverts the buffer to disk, reapplies the unsaved change and keeps the cursor, with a notice naming the writer', async () => {
  reset()
  const file = path.join(tmp, 'clean.tsx')
  writeFileSync(file, BASE)
  const merger = new Merger()
  const { doc, editor } = openDoc(file, BASE)
  assert.equal(merger.base(file), BASE)
  doc.type(BASE.replace('const b = 2', 'const b = 20'))
  // the cursor after the user's edit, on line 2
  editor.selections = [new vscode.Selection(new vscode.Position(2, 12), new vscode.Position(2, 12))]
  // an agent inserts a line above and changes another below
  const theirs = BASE.replace('const a = 1\n', 'const a = 1\nconst z = 0\n').replace('const d = 4', 'const d = 40')
  writeFileSync(file, theirs)
  assert.equal(await merger.shadowed(file, 'Claude Code'), 'clean')
  assert.ok(
    commands.some(c => c[0] === 'workbench.action.files.revert' && c[1].fsPath === file),
    'reverted first, so a save never meets a newer file on disk',
  )
  assert.equal(doc.getText(), theirs.replace('const b = 2', 'const b = 20'))
  assert.ok(doc.isDirty, 'the unsaved change stays unsaved')
  assert.deepEqual([editor.selections[0].active.line, editor.selections[0].active.character], [3, 12], 'the cursor moved with its line')
  const note = ui.calls.find(c => c.kind === 'info')
  assert.match(note.text, /merged Claude Code's change to .*clean\.tsx into your unsaved text/)
  assert.equal(merger.base(file), theirs, 'the disk text is the next base')
  merger.dispose()
})

test('a conflict opens the merge editor with base, the unsaved text and the disk, and leaves the buffer unsaved', async () => {
  reset()
  const file = path.join(tmp, 'conflict.tsx')
  writeFileSync(file, BASE)
  const merger = new Merger()
  const { doc } = openDoc(file, BASE)
  const ours = BASE.replace('const c = 3', 'const c = 30')
  doc.type(ours)
  const theirs = BASE.replace('const c = 3', 'const c = 33')
  writeFileSync(file, theirs)
  assert.equal(await merger.shadowed(file, 'Codex'), 'conflict')
  const open = commands.find(c => c[0] === '_open.mergeEditor')
  assert.ok(open, 'the merge editor opened')
  const arg = open[1]
  const text = uri => contentProviders['pcbjs-merge'].provideTextDocumentContent(uri)
  assert.deepEqual([text(arg.base), text(arg.input1.uri), text(arg.input2.uri)], [BASE, ours, theirs])
  assert.equal(arg.input2.title, 'Codex')
  assert.equal(arg.output.toString(), doc.uri.toString())
  assert.ok(doc.isDirty, 'held until resolved')
  assert.match(doc.getText(), /<<<<<<< your unsaved text\nconst c = 30\n=======\nconst c = 33\n>>>>>>> Codex/)
  assert.match(ui.calls.find(c => c.kind === 'warning').text, /Codex's change to .* conflicts with your unsaved text/)
  merger.dispose()
})

test('no merge for a clean buffer, for the editor own save, or for a file not open', async () => {
  reset()
  const file = path.join(tmp, 'own.tsx')
  writeFileSync(file, BASE)
  const merger = new Merger()
  const { doc } = openDoc(file, BASE)
  assert.equal(await merger.shadowed(file, null), 'none', 'a clean buffer follows the disk by itself')
  const mine = BASE.replace('const a = 1', 'const a = 10')
  doc.type(mine)
  writeFileSync(file, mine)
  assert.equal(await merger.shadowed(file, null), 'none', 'the disk holds the buffer: the editor saved')
  assert.equal(await merger.shadowed(path.join(tmp, 'closed.tsx'), null), 'none')
  assert.equal(commands.length, 0)
  merger.dispose()
})
