// Two projects of one workspace session compile at once: a check of a small project is answered while a slow one still compiles,
// as each project has its own runtime, compile thread and scheduler, and no lock is shared between them.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serveSession } from '../dist/session/serve.js'
import { connectSession } from '../dist/session/client.js'
import { board } from './fixtures/workspace.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
/** ms the slow project's module takes to evaluate */
const SLOW_MS = 6000

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-concurrent-')))
after(() => rmSync(root, { recursive: true, force: true }))
mkdirSync(join(root, 'node_modules'))
symlinkSync(join(REPO, 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
const config = "import { defineConfig } from '@pcbjs/core'\nexport default defineConfig({ entries: ['pcb.tsx'], vite: { logLevel: 'silent' } })\n"
for (const [name, extra] of [
  ['slow', `const t0 = Date.now()\nwhile (Date.now() - t0 < ${SLOW_MS}) {}`],
  ['fast', ''],
]) {
  mkdirSync(join(root, name))
  writeFileSync(join(root, name, 'pcb.config.ts'), config)
  writeFileSync(join(root, name, 'pcb.tsx'), board(name === 'slow' ? 'Slow' : 'Fast', extra))
}

test('a query on one project is answered while another project of the session compiles', { timeout: 120000 }, async () => {
  const log = console.log
  console.log = () => {}
  const session = await serveSession({ folders: [root], port: 0, host: '127.0.0.1', log: () => {} })
  console.log = log
  session.server.config.logger.info = () => {}
  const c = await connectSession(session.info().socket, { name: 'test' })
  try {
    const events = []
    c.onEvent((event, data) => event === 'session/event' && events.push({ at: performance.now(), ...data }))
    await c.request('session/events', { follow: true, kind: ['compile'] })
    const slow = join(root, 'slow')
    const fast = join(root, 'fast')
    const t0 = performance.now()
    const slowDone = c.request('session/check', { project: slow }, 100000).then(() => performance.now() - t0)
    // the slow compile has begun
    for (let i = 0; i < 400 && !events.some(e => e.project === slow && e.data.state === 'started'); i++) await new Promise(r => setTimeout(r, 25))
    assert.ok(
      events.some(e => e.project === slow && e.data.state === 'started'),
      'the slow project compiles',
    )
    const check = await c.request('session/check', { project: fast }, 100000)
    const fastAt = performance.now() - t0
    assert.match(check.value.stdout, /Fast/)
    const slowMs = await slowDone
    assert.ok(fastAt < slowMs, `the fast check answered at ${Math.round(fastAt)} ms, before the slow one at ${Math.round(slowMs)} ms`)
    // both compiled at once: the fast run began and minted its snapshot inside the slow run
    const at = (project, pred) => events.find(e => e.project === project && pred(e.data))?.at
    const slowStart = at(slow, d => d.state === 'started')
    const slowEnd = at(slow, d => 'stage' in d)
    const fastStart = at(fast, d => d.state === 'started')
    const fastEnd = at(fast, d => 'stage' in d)
    assert.ok(slowStart < fastStart && fastEnd < slowEnd, JSON.stringify({ slowStart, fastStart, fastEnd, slowEnd }))
  } finally {
    c.close()
    await session.stop('test')
  }
})
