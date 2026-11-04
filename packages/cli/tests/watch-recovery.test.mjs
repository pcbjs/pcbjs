import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveSession } from '../dist/session/serve.js'
import { makeStack, stackBoard } from './fixtures/workspace.mjs'
import { viewerClient } from './fixtures/viewer.mjs'

for (const kind of ['source', 'config', 'hidden config']) {
  test(`a missed ${kind} watcher event recovers ${kind === 'hidden config' ? 'when shown' : 'on the heartbeat'}`, { timeout: 30000 }, async () => {
    const w = makeStack(),
      runtimeDir = process.env.XDG_RUNTIME_DIR
    process.env.XDG_RUNTIME_DIR = join(w.root, '.run')
    const config = kind !== 'source'
    if (config) writeFileSync(join(w.a, 'second.tsx'), stackBoard('A', '2'))
    let session, viewer
    try {
      session = await serveSession({ projects: [{ dir: w.a }], folders: [], port: 0, host: '127.0.0.1', log() {} })
      viewer = await viewerClient(new URL(session.info().url).port, { board: 'A', facets: ['meta'] })
      const initial = await viewer.next('pcbjs:facet', { pred: e => e.facet === 'meta' && e.data.rev === '1' })
      assert.ok(initial)
      assert.ok(await viewer.next('pcbjs:status', { pred: e => e.phase === 'idle' && e.run === initial.run }))
      const file = join(w.a, config ? 'pcb.config.ts' : 'pcb.tsx')
      let delivered = 0
      session.server.watcher.on('change', changed => {
        if (changed === file) delivered++
      })
      session.server.watcher.unwatch(file)
      const from = viewer.got.length
      writeFileSync(file, config ? "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['second.tsx'] })\n" : stackBoard('A', '2'))
      if (kind === 'hidden config') {
        const closed = new Promise(r => viewer.ws.once('close', r))
        viewer.close()
        await closed
        const response = await fetch(new URL('__pcbjs/scope/a', session.info().url))
        const payload = await response.json()
        assert.equal(payload.boards[0]?.facets.meta.rev, '2', 'showing reloads configuration before compiling')
      } else {
        const updated = await viewer.next('pcbjs:facet', { from, pred: e => e.facet === 'meta' && e.data.rev === '2', ms: 12000 })
        assert.ok(updated, 'the visible board converges without another user action')
        assert.ok(await viewer.next('pcbjs:status', { from, pred: e => e.phase === 'idle' && e.run === updated.run }))
      }
      assert.equal(delivered, 0, 'recovery did not rely on the file watcher')
    } finally {
      viewer?.close()
      await session?.stop('test')
      if (runtimeDir === undefined) delete process.env.XDG_RUNTIME_DIR
      else process.env.XDG_RUNTIME_DIR = runtimeDir
      rmSync(w.root, { recursive: true, force: true })
    }
  })
}
