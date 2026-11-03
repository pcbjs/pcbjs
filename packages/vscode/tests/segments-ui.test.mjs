import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vscode, ui, openDoc } from './vscode.mjs'

const { SegmentsUi } = createRequire(import.meta.url)('../dist/segments-ui.cjs')

test('native value choices and text accept once, cancellation never writes, auto-save follows its setting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-value-'))
  const file = join(dir, 'pcb.tsx')
  writeFileSync(file, '10')
  const { doc } = openDoc(file, '10')
  let applies = 0
  const segment = { value: '10', label: 'width', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, widget: { typed: true }, presentations: [{ label: '20', value: '20' }] }
  const session = {
    segmentAt: async () => segment,
    typed: async (_uri, _pos, value) => value === 'bad' ? { error: 'invalid width', presentations: [] } : { presentations: [{ value }] },
    apply: async (_uri, p) => {
      applies++
      doc.type(p.value)
      return true
    },
  }
  const editor = new SegmentsUi(() => session)
  const edit = () => editor.edit(doc.uri.toString(), new vscode.Position(0, 0))
  try {
    ui.answers.push(['pick', undefined])
    await edit()
    assert.equal(applies, 0)
    ui.answers.push(['pick', c => c.items[0]], ['input', undefined])
    await edit()
    assert.equal(applies, 0)
    assert.equal(doc.text, '10')
    assert.equal(readFileSync(file, 'utf8'), '10')
    ui.answers.push(['pick', c => c.items[0]], ['input', async c => {
      assert.equal(await c.validateInput('bad'), 'invalid width')
      assert.equal(await c.validateInput('30'), undefined)
      return '30'
    }])
    ui.autoSave = false
    await edit()
    assert.equal(applies, 1)
    assert.equal(doc.text, '30')
    assert.equal(readFileSync(file, 'utf8'), '10')
    ui.autoSave = true
    ui.answers.push(['pick', c => c.items[1]])
    await edit()
    assert.equal(applies, 2)
    assert.equal(readFileSync(file, 'utf8'), '20')
    ui.answers.push(['pick', c => c.items[0]], ['input', async c => {
      await c.validateInput('30')
      return 'bad'
    }])
    await edit()
    assert.equal(applies, 2, 'accepted text is revalidated even if a previous callback was valid')
    assert.equal(readFileSync(file, 'utf8'), '20')
    segment.widget.typed = false
    await edit()
    assert.equal(applies, 3, 'one non-typed presentation is an immediate action')
  } finally {
    delete ui.autoSave
    editor.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
