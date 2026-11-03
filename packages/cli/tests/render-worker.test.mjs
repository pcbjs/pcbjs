// The session's renderer worker against a stand-in runtime: a trap and an exit each retried once on a fresh thread then
// failing, a shot of an older snapshot cancelled by a newer one, the queue bound, the timeout and the recycle.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RenderWorker, LIMITS } from '../dist/render/worker-client.js'

const url = new URL('./fixtures/fake-renderer.mjs', import.meta.url)
const dir = mkdtempSync(join(tmpdir(), 'pcbjs-render-worker-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const scene = (key, snapshot = 's.1', project = '/p') => ({ key, project, snapshot, glb: new Uint8Array(4), selection: [] })
const shoot = (w, s) => w.shot(s, null, { width: 1, height: 1 })
const code = p =>
  p.then(
    () => 'ok',
    e => e.code,
  )

test('the limits sit in one place', () => {
  assert.deepEqual(Object.keys(LIMITS).sort(), ['growth', 'queue', 'scenes', 'timeout'])
})

test('a trap is retried once on a fresh thread with the scene uploaded again, then fails the shot', async () => {
  const w = new RenderWorker({ url })
  try {
    assert.equal((await shoot(w, scene(`trap-once:${join(dir, 't1')}`))).width, 1, 'the retry answered')
    assert.equal(w.stats.retried, 1)
    assert.equal(w.stats.spawned, 2)
    assert.equal(await code(shoot(w, scene('trap'))), 'WASM_TRAP', 'a second trap fails the shot')
    assert.equal(w.stats.retried, 2)
    assert.equal(await code(shoot(w, scene('ok'))), 'ok', 'the worker serves the next shot')
  } finally {
    await w.close()
  }
})

test('a thread that exits is treated as a trap: retried once, then the shot fails', async () => {
  const w = new RenderWorker({ url })
  try {
    assert.equal(await code(shoot(w, scene(`exit-once:${join(dir, 'e1')}`))), 'ok')
    assert.equal(w.stats.retried, 1)
    assert.equal(await code(shoot(w, scene('exit'))), 'WORKER_EXIT')
    assert.equal(await code(shoot(w, scene('ok'))), 'ok')
  } finally {
    await w.close()
  }
})

test('a newer snapshot of the project terminates the running shot of the older and drops its queued ones; other projects keep theirs', async () => {
  const w = new RenderWorker({ url })
  try {
    const running = code(shoot(w, scene('hang', 's.1')))
    const queued = code(shoot(w, scene('ok', 's.1')))
    const other = code(shoot(w, scene('ok', 's.1', '/q')))
    const newer = code(shoot(w, scene('ok', 's.2')))
    assert.deepEqual(await Promise.all([running, queued, other, newer]), ['CANCELLED', 'CANCELLED', 'ok', 'ok'])
    assert.equal(w.stats.cancelled, 2)
  } finally {
    await w.close()
  }
})

test('the queue is bounded and a shot past the timeout fails while the next one runs', async () => {
  const w = new RenderWorker({ url, limits: { queue: 2, timeout: 300 } })
  try {
    const a = code(shoot(w, scene('hang')))
    const b = code(shoot(w, scene('ok')))
    assert.equal(await code(shoot(w, scene('ok'))), 'QUEUE_FULL')
    assert.deepEqual(await Promise.all([a, b]), ['TIMEOUT', 'ok'])
  } finally {
    await w.close()
  }
})

test('a thread is recycled after its scene count, the next shot on a fresh one', async () => {
  const w = new RenderWorker({ url, limits: { scenes: 2 } })
  try {
    for (const k of ['a', 'b', 'c']) assert.equal(await code(shoot(w, scene(k, `s.${k}`, `/${k}`))), 'ok')
    assert.equal(w.stats.recycled, 1)
    assert.equal(w.stats.spawned, 2)
  } finally {
    await w.close()
  }
})

test('a closed worker refuses shots', async () => {
  const w = new RenderWorker({ url })
  await w.close()
  assert.equal(await code(shoot(w, scene('ok'))), 'CLOSED')
})
