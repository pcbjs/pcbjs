import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeStack, shared } from './fixtures/workspace.mjs'
import { serveSession } from '../dist/session/serve.js'
import { connectSession } from '../dist/session/client.js'
import { sameFile } from '../dist/project/files.js'

test('a workspace opened with editor path spelling follows saved imports and config changes', { timeout: 60000 }, async () => {
  const w = makeStack()
  const folder = process.platform === 'win32' ? w.stack.toLowerCase() : w.stack
  let session, observer
  try {
    session = await serveSession({ folders: [folder], port: 0, host: '127.0.0.1', log() {} })
    observer = await connectSession(session.info().socket, { name: 'paths', capabilities: ['findings'] })
    const base = `http://127.0.0.1:${session.server.httpServer.address().port}`
    assert.equal((await fetch(`${base}/__pcbjs/scope/a`)).status, 200)
    const scope = session.workspace.scopes.find(s => s.slug === 'a')
    const compiled = () => scope.state?.slots[0].compiled?.[0]
    assert.equal(compiled().board.title, 'T1')
    const dependency = join(w.lib, 'shared.ts')
    assert.ok(
      scope.files.some(f => sameFile(f, dependency)),
      'imported files remain watched across Vite path spelling',
    )
    const until = async predicate => {
      for (const end = Date.now() + 15000; !predicate() && Date.now() < end;) await new Promise(r => setTimeout(r, 25))
      assert.ok(predicate(), 'the live viewer received the saved source')
    }
    writeFileSync(dependency, shared('Saved import'))
    await until(() => compiled()?.board.title === 'Saved import')
    writeFileSync(
      join(w.a, 'pcb.config.ts'),
      "import { defineConfig, defineDefaultBoard } from '@pcbjs/core'\ndefineDefaultBoard({ rules: { clearance: 0.42 } })\nexport default defineConfig({ entries: ['pcb.tsx'] })\n",
    )
    await until(() => compiled()?.board.rules.clearance === 0.42)
  } finally {
    observer?.close()
    await session?.stop('test')
    rmSync(w.root, { recursive: true, force: true })
  }
})
