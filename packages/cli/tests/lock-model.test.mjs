import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectRuntime } from '../dist/session/runtime.js'

test('advisory lock models use coherent partial output and reject changed, failed or removed sources without compiling', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-lock-model-'))
  const file = join(root, 'pcb.tsx')
  writeFileSync(file, 'initial')
  let run = 0,
    snap = null,
    calls = 0,
    fail = false
  const compiler = {
    graph: () => ({ getModulesByFile: () => undefined }),
    imported: () => new Set([file]),
    changed() {},
    cancel() {},
    close: async () => {},
    compile: async (entry, job) => {
      calls++
      if (fail) throw new Error('bad source')
      return [
        {
          entry,
          board: { name: 'B', title: readFileSync(file, 'utf8'), drc: [], erc: [] },
          site: { name: 'B' },
          hashes: {},
          files: [file],
          ...(job.want ? { partial: job.want } : {}),
        },
      ]
    },
  }
  const scope = { cfg: { root }, entries: [], files: [], stamps: new Map(), state: { slots: [{ entry: { file, rel: 'pcb.tsx' } }], compiler } }
  const rt = projectRuntime(scope, {
    snaps: { reserve: () => ++run, last: () => run, current: () => snap, commit: (s, run) => (snap = { ...s, run, id: `test.${run}` }) },
    tiers: { keystroke: 1, quiet: 1 },
    drafts: () => null,
    settle: async () => new Set(),
    viewers: () => 0,
    invalidated() {},
    shadow() {},
    flushFeed() {},
    log() {},
    watch() {},
    closing: () => false,
    clientDir: '/client',
  })
  const finish = async () => {
    for (const end = Date.now() + 3000; rt.busy() && Date.now() < end;) await new Promise(r => setTimeout(r, 10))
    assert.equal(rt.busy(), false)
  }
  try {
    await rt.compiledOnce()
    assert.equal(rt.lockModel('B', 'pcb').title, 'initial')
    rt.demand(new Map([[file, ['meta', 'layers']]]))
    writeFileSync(file, 'moved placement')
    assert.equal(rt.lockModel('B', 'pcb'), null)
    rt.edit(file, false)
    await finish()
    const before = calls
    assert.equal(rt.lockModel('B', 'pcb').title, 'moved placement')
    assert.equal(rt.lockModel('B', 'sch'), null, 'uncompiled schematic stays unavailable')
    assert.equal(calls, before, 'advisory reads start no compile')
    fail = true
    writeFileSync(file, 'bad')
    rt.edit(file, false)
    await finish()
    assert.equal(rt.lockModel('B', 'pcb'), null)
    scope.state.slots = []
    assert.equal(rt.lockModel('B', 'pcb'), null)
  } finally {
    await rt.close()
    rmSync(root, { recursive: true, force: true })
  }
})
