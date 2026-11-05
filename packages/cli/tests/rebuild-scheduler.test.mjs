import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectRuntime } from '../dist/session/runtime.js'

test('explicit rebuilds serialize selected entries through scheduler and preserve editor input authority', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-scheduler-rebuild-')))
  const files = ['a.tsx', 'b.tsx'].map(rel => join(root, rel))
  files.forEach(f => writeFileSync(f, 'saved input'))
  let snap = null,
    seq = 0,
    active = 0,
    maxActive = 0,
    cancelOnce = false
  const calls = []
  const compiler = {
    graph: () => ({ getModulesByFile: () => undefined }),
    imported: file => new Set([file]),
    changed() {},
    cancel() {},
    close: async () => {},
    async compile(entry, job) {
      active++
      maxActive = Math.max(maxActive, active)
      calls.push({ file: entry.file, policy: job.rebuild, draft: job.draft })
      await new Promise(r => setTimeout(r, 10))
      active--
      if (cancelOnce && job.rebuild === 'all') {
        cancelOnce = false
        throw Object.assign(new Error('edit cancelled'), { name: 'CancelledError' })
      }
      return [{ entry, run: seq, board: { name: entry.rel, drc: [], erc: [] }, site: { name: entry.rel, footprints: [] }, hashes: {}, files: [entry.file] }]
    },
  }
  const drafts = { files: () => [files[0]], get: () => ({ text: 'unsaved input', code: 'unsaved input', skipped: [] }), holds: () => [], flush: async () => {} }
  const rt = projectRuntime(
    { cfg: { root }, entries: [], files: [], stamps: new Map(), state: { slots: files.map(file => ({ entry: { file, rel: file.split('/').at(-1) } })), compiler } },
    {
      snaps: { reserve: () => ++seq, last: () => seq, current: () => snap, commit: (s, run) => (snap = { ...s, id: `test.${run}`, run }) },
      tiers: { keystroke: 10, quiet: 20 },
      drafts: () => drafts,
      settle: async () => new Set(),
      viewers: () => 0,
      invalidated() {},
      shadow() {},
      watch() {},
      flushFeed() {},
      log(line) {
        assert.match(line, /an edit cancelled/)
      },
      closing: () => false,
      clientDir: '/client',
    },
  )
  try {
    await rt.compiledOnce()
    calls.length = 0
    cancelOnce = true
    await Promise.all([rt.refresh(['a.tsx'], 'all', 2000), rt.refresh(['a.tsx'], 'warm', 2000)])
    assert.deepEqual(
      calls.map(c => [c.file, c.policy, c.draft]),
      [
        [files[0], 'all', true],
        [files[0], 'all', true],
        [files[0], 'warm', true],
      ],
    )
    assert.equal(maxActive, 1)
    assert.equal(snap.texts.get(files[0]), 'unsaved input')
    assert.ok(snap.overlay.has(files[0]))
    await assert.rejects(rt.refresh(['missing.tsx'], 'all', 2000), /configured entries/)
    assert.equal(calls.length, 3)
  } finally {
    await rt.close()
    rmSync(root, { recursive: true, force: true })
  }
})
