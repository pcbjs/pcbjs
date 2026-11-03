import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectRuntime } from '../dist/session/runtime.js'
import { stampFiles } from '../dist/session/scopes.js'

for (const phase of ['steady', 'draft flush', 'pending watcher']) {
 test(`settle rechecks a snapshot advancing during ${phase} before querying again`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-settle-'))
  const file = join(root, 'pcb.tsx')
  writeFileSync(file, 'current source')
  const before = { stamps: new Map([[file, 'old stamp']]), overlay: new Map() }
  const after = { stamps: stampFiles([file]), overlay: new Map() }
  let snap = phase === 'pending watcher' ? after : before
  let invalidated = 0
  const drafts = { files: () => [], holds: () => [], flush: async () => { if (phase === 'draft flush') snap = after } }
  const rt = projectRuntime({
    cfg: { root }, entries: [], files: [], stamps: new Map(),
    state: { slots: [], compiler: { graph: () => ({ getModulesByFile: () => undefined }), changed: () => invalidated++, cancel() {}, close: async () => {} } },
  }, {
    snaps: { current: () => snap }, tiers: { keystroke: 30, quiet: 300 },
    drafts: () => drafts, closing: () => false, shadow() {}, watch() {}, log() {},
  })
  try {
    if (phase === 'pending watcher') rt.edit(file, false)
    const settling = rt.settle(1000)
    if (phase === 'steady') snap = after
    const result = await settling
    assert.equal(result.snap, after)
    assert.equal(result.stale, null)
    assert.equal(invalidated, 0, 'a completed snapshot must not enqueue another compile')
  } finally {
    await rt.close()
    rmSync(root, { recursive: true, force: true })
  }
})
}
