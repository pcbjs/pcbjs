// The thin worker boundary on usb3-hub, worker-boundary.mjs: a warm compile whose stages all hit blocks the session's main thread
// under 20 ms and carries under 8 MB.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { boundaryBench } from './worker-boundary.mjs'

const ROOT = join(import.meta.dirname, '..', '..', '..', 'examples', 'usb3-hub')
const MB = 1024 * 1024

test('a warm all-hit compile of usb3-hub blocks the main thread under 20 ms and carries under 8 MB', { timeout: 300000 }, async () => {
  const r = await boundaryBench(ROOT)
  assert.ok(r.warm.block < 20, JSON.stringify(r))
  assert.ok(r.warm.bytes < 8 * MB, JSON.stringify(r))
})
