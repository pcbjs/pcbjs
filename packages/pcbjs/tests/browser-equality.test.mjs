// The browser compile against Node's on the demo boards and highspeed in a headless Chromium, see docs/browser.md; skipped with a notice without one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { chromes } from '../../../scripts/browser-equality.mjs'

const script = join(import.meta.dirname, '..', '..', '..', 'scripts', 'browser-equality.mjs')
// the ports a worker was given, else free ones
const ports = ['--port', process.env.PCBJS_EQ_PORT ?? '0', '--devtools', process.env.PCBJS_EQ_DEVTOOLS ?? '0']
const skip = process.platform === 'win32' ? 'the equality runs on Linux and macOS' : chromes().length ? false : 'no Chromium found; set PCBJS_CHROME to one'

test('browser equality: the demo boards and highspeed compile in Chromium to Node’s board JSON, finding ids and lengths', { skip, timeout: 600000 }, () => {
  const r = spawnSync(process.execPath, [script, ...ports], { encoding: 'utf8', maxBuffer: 64 << 20 })
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
  assert.match(r.stdout, /every target agrees between the browser and Node/)
})
