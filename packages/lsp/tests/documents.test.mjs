// The document store: the editor that synced a file last holds it, an agent only a file no editor holds, a reader never;
// save or close by the holder and a disconnect release it, and every change reaches the listeners by the real path.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { documentStore, realFile } from '../dist/documents.js'

const editor = (id, name) => ({ id, role: 'editor', name })
const agent = id => ({ id, role: 'agent' })

test('holders: the last editor, an agent only beside none, a reader never', () => {
  const s = documentStore()
  const changes = []
  s.onChange(c => changes.push([c.file, c.doc?.text ?? null, c.by.id]))
  const f = realFile('/tmp/pcbjs-store-x.tsx')
  assert.equal(s.sync(f, 'agent text', 1, agent('a')), true, 'nobody holds it: the agent may')
  assert.equal(s.holderOf(f).id, 'a')
  assert.equal(s.sync(f, 'mine', 1, editor('e1', 'Code')), true)
  assert.equal(s.sync(f, 'agent again', 2, agent('a')), false, 'an editor holds it now')
  assert.equal(s.get(f).text, 'mine')
  assert.equal(s.sync(f, 'second human', 1, editor('e2')), true, 'two editors are two humans: the last one holds it')
  assert.equal(s.holderOf(f).id, 'e2')
  assert.equal(s.sync(f, 'read only', 1, { id: 'r', role: 'reader' }), false)
  s.release(f, editor('e1'))
  assert.equal(s.get(f).text, 'second human', 'only the holder releases')
  s.release(f, editor('e2'))
  assert.equal(s.get(f), undefined)
  assert.deepEqual(changes, [
    [f, 'agent text', 'a'],
    [f, 'mine', 'e1'],
    [f, 'second human', 'e2'],
    [f, null, 'e2'],
  ])
})

test('a disconnect releases every file the connection held; versions count every change', () => {
  const s = documentStore()
  const e = editor('e')
  s.sync('/tmp/pcbjs-a.tsx', 'a', 1, e)
  s.sync('/tmp/pcbjs-b.tsx', 'b', 1, e)
  s.sync('/tmp/pcbjs-c.tsx', 'c', 1, agent('x'))
  const seq = s.get('/tmp/pcbjs-a.tsx').seq
  s.sync('/tmp/pcbjs-a.tsx', 'a2', 2, e)
  assert.ok(s.get('/tmp/pcbjs-a.tsx').seq > seq)
  s.releaseAll(e)
  assert.deepEqual(s.files(), [realFile('/tmp/pcbjs-c.tsx')])
})

test('a file named through a symbolic link is one document under its real path', () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'pcbjs-store-')))
  try {
    writeFileSync(join(dir, 'pcb.tsx'), 'disk')
    symlinkSync(dir, join(dir, 'link'), 'dir')
    const s = documentStore()
    let got = null
    s.onChange(c => (got = c))
    s.sync(join(dir, 'link', 'pcb.tsx'), 'open', 1, editor('e'))
    assert.equal(got.file, join(dir, 'pcb.tsx'))
    assert.equal(got.named, join(dir, 'link', 'pcb.tsx'))
    assert.equal(s.get(join(dir, 'pcb.tsx')).text, 'open')
    assert.equal(s.holderOf(join(dir, 'link', 'pcb.tsx')).id, 'e')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Windows editor drive case and Vite separators share one authoritative document', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-store-'))
  try {
    const file = join(dir, 'pcb.tsx')
    writeFileSync(file, 'disk')
    const editorFile = file.replace(/^[A-Z]:/, drive => drive.toLowerCase())
    const viteFile = file.replace(/\\/g, '/')
    const s = documentStore()
    s.sync(editorFile, 'unsaved editor text', 1, editor('e'))
    assert.equal(s.get(viteFile)?.text, 'unsaved editor text')
    assert.equal(s.sync(viteFile, 'agent overwrite', 2, agent('a')), false)
    assert.equal(s.files().length, 1)
    s.release(viteFile, editor('e'))
    assert.equal(s.get(editorFile), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
