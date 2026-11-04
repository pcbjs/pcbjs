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

test('compiling one board cannot bless an unreported disk edit of another board', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-watch-two-'))
  const files = ['a.tsx', 'b.tsx'].map(f => join(root, f))
  files.forEach(f => writeFileSync(f, 'old'))
  let run = 0,
    snap = null
  const calls = []
  const compiler = {
    graph: () => ({ getModulesByFile: file => [{ file, importers: new Set() }] }),
    imported: file => new Set([file]),
    changed() {},
    cancel() {},
    close: async () => {},
    compile: async entry => {
      const title = readFileSync(entry.file, 'utf8')
      calls.push([entry.rel, title])
      return [{ entry, board: { name: entry.rel, title, drc: [], erc: [] }, site: { name: entry.rel }, hashes: {}, files: [entry.file] }]
    },
  }
  const scope = { cfg: { root }, entries: [], files: [], stamps: new Map(), state: { slots: files.map((file, i) => ({ entry: { file, rel: `${i}.tsx` } })), compiler } }
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
    watch() {},
    closing: () => false,
    clientDir: '/client',
  })
  const idle = async () => {
    for (const end = Date.now() + 3000; rt.busy() && Date.now() < end;) await new Promise(r => setTimeout(r, 10))
    assert.equal(rt.busy(), false)
  }
  try {
    await rt.compiledOnce()
    rt.demand(new Map(files.map(f => [f, null])))
    files.forEach(f => writeFileSync(f, 'new'))
    rt.edit(files[0], false)
    await idle()
    assert.notEqual(scope.stamps.get(files[1]), stampFiles([files[1]]).get(files[1]))
    assert.equal(snap.texts.get(files[1]), 'old', 'the snapshot retains the source its second board actually compiled')
    rt.catchUp()
    await idle()
    assert.ok(calls.some(([entry, title]) => entry === '1.tsx' && title === 'new'))
    assert.equal(snap.slots[1].compiled[0].board.title, 'new')
    rt.demand(new Map([[files[0], null]]))
    writeFileSync(files[1], 'new while hidden')
    const before = calls.length
    rt.catchUp()
    await idle()
    assert.equal(calls.length, before, 'a missed edit of a hidden board does not rebuild the visible board')
    rt.catchUp()
    assert.equal(rt.busy(), false, 'a recovered notification is not scheduled again each heartbeat')
    rt.demand(new Map(files.map(f => [f, null])))
    await idle()
    assert.ok(calls.some(([entry, title]) => entry === '1.tsx' && title === 'new while hidden'))
  } finally {
    await rt.close()
    rmSync(root, { recursive: true, force: true })
  }
})
