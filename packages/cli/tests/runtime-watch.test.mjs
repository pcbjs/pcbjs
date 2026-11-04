import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectRuntime } from '../dist/session/runtime.js'
import { stampFiles } from '../dist/session/scopes.js'

for (const partial of [false, true]) {
  test(`an edit at ${partial ? 'partial' : 'full'} completion stays newer than the watched baseline`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'pcbjs-watch-'))
    const file = join(root, 'pcb.tsx'),
      dependency = join(root, 'layout.tsx')
    writeFileSync(file, 'board source')
    writeFileSync(dependency, 'old layout')
    let run = 0,
      snap = null,
      calls = 0,
      invalidations = 0,
      compiledTitle = null
    const tracked = new Set()
    const compiler = {
      graph: () => ({ getModulesByFile: () => undefined }),
      imported: () => new Set(calls ? [file, dependency] : [file]),
      changed: () => invalidations++,
      cancel() {},
      close: async () => {},
      compile: async entry => {
        calls++
        compiledTitle = readFileSync(dependency, 'utf8')
        const board = { name: 'B', title: compiledTitle, drc: [], erc: [] }
        return [{ entry, board, site: { name: 'B' }, hashes: {}, files: [file, dependency], ...(partial ? { partial: ['meta'] } : {}) }]
      },
    }
    const scope = { cfg: { root }, entries: [], files: [], stamps: new Map(), state: { slots: [{ entry: { file, rel: 'pcb.tsx' } }], compiler } }
    const rt = projectRuntime(scope, {
      snaps: { reserve: () => ++run, last: () => run, current: () => snap, commit: (s, run) => (snap = { ...s, run, id: `test.${run}` }) },
      tiers: { keystroke: 30, quiet: 300 },
      drafts: () => null,
      settle: async () => new Set(),
      viewers: () => 0,
      invalidated() {},
      shadow() {},
      flushFeed() {},
      log() {},
      watch: files => files.forEach(f => tracked.add(f)),
      closing: () => false,
      clientDir: '/client',
    })
    rt.on(e => {
      if (e.t !== 'committed' || calls !== 1) return
      assert.ok(tracked.has(dependency), 'new imports are registered before completion reaches clients')
      writeFileSync(dependency, 'new layout after completion')
    })
    try {
      await rt.compiledOnce()
      assert.notEqual(scope.stamps.get(dependency), stampFiles([dependency]).get(dependency), 'completion callbacks cannot bless later disk contents')
      rt.demand(new Map([[file, null]]))
      rt.catchUp()
      assert.equal(invalidations, 1, 'catch-up invalidates the stale compiler module')
      assert.equal(rt.busy(), true, 'the missed watcher event still schedules a compile')
      for (const end = Date.now() + 3000; rt.busy() && Date.now() < end;) await new Promise(r => setTimeout(r, 10))
      assert.equal(rt.busy(), false)
      assert.equal(calls, 2)
      assert.equal(compiledTitle, 'new layout after completion')
    } finally {
      await rt.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
}
