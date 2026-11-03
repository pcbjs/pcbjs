// The status bar item for every phase, and the phase values the server holds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { statusOf } = require('../dist/status.cjs')
const { running, connected, DETACHED } = require('../dist/phase.cjs')
const { PROTOCOL, MAJOR } = require('@pcbjs/core/protocol')

const info = (protocol = PROTOCOL) => ({ session: 's1', pid: 42, version: '0.0.1-beta.1', root: '/w', protocol, major: MAJOR })
const URL = 'http://127.0.0.1:5301/'
const INST = { version: '0.0.1-beta.2', dir: '/w', skew: null, linked: false }
const NONE = { version: null, dir: null, skew: null, linked: false }
const SKEW = { ...INST, skew: '@pcbjs packages disagree on the version: a, b' }
const HOLD = { file: 'pcb.tsx', line: 42 }

test('phase: running knows an older session; restarting and failed are not connected', () => {
  assert.equal(running(URL, info()).older, false)
  assert.equal(running(URL, info(PROTOCOL - 1)).older, true)
  assert.deepEqual(
    [
      DETACHED,
      { kind: 'attaching', attempt: 0 },
      running(URL, info()),
      { kind: 'restarting', clearing: false },
      { kind: 'reconnecting', attempt: 1 },
      { kind: 'failed', reason: 'x' },
    ].map(connected),
    [false, true, true, false, true, false],
  )
})

test('the status table: text, command and tone of every phase', () => {
  const rows = [
    [DETACHED, INST, undefined, '$(debug-start) pcbjs 0.0.1-beta.2', 'pcbjs.pickView', undefined],
    [{ kind: 'attaching', attempt: 0 }, INST, undefined, '$(sync~spin) pcbjs 0.0.1-beta.2: attaching', 'pcbjs.pickView', undefined],
    [running(URL, info()), INST, undefined, '$(circuit-board) pcbjs 0.0.1-beta.2: 2 boards', 'pcbjs.pickView', undefined],
    [running(URL, info()), INST, HOLD, 'pcbjs: holding, pcb.tsx:42 has an error', 'pcbjs.pickView', undefined],
    [running(URL, info(PROTOCOL - 1)), INST, undefined, '$(warning) pcbjs 0.0.1-beta.2: older session', 'pcbjs.restartServer', 'warning'],
    [{ kind: 'restarting', clearing: false }, INST, undefined, '$(sync~spin) pcbjs 0.0.1-beta.2: restarting', 'pcbjs.pickView', undefined],
    [{ kind: 'restarting', clearing: true }, INST, undefined, '$(sync~spin) pcbjs 0.0.1-beta.2: restarting, clearing caches', 'pcbjs.pickView', undefined],
    [{ kind: 'reconnecting', attempt: 2 }, INST, undefined, '$(sync~spin) pcbjs 0.0.1-beta.2: reconnecting', 'pcbjs.pickView', undefined],
    [{ kind: 'failed', reason: 'gone' }, INST, undefined, '$(error) pcbjs 0.0.1-beta.2: failed', 'pcbjs.openSessionLog', 'error'],
    [DETACHED, NONE, undefined, '$(circuit-board) pcbjs: Not installed', 'pcbjs.install', undefined],
    [running(URL, info(PROTOCOL - 1)), SKEW, undefined, '$(warning) pcbjs 0.0.1-beta.2: 2 boards', 'pcbjs.install', 'warning'],
  ]
  for (const [phase, inst, hold, text, command, tone] of rows) {
    const s = statusOf(phase, inst, hold, 2, true)
    assert.deepEqual([s.text, s.command, s.tone], [text, command, tone], `${phase.kind} ${text}`)
  }
})

test('the tooltip names the session, the older version, the failure log and what a click does', () => {
  const run = statusOf(running(URL, info()), INST, undefined, 1, false).tooltip.split('\n')
  assert.deepEqual(run, [`@pcbjs/pcbjs 0.0.1-beta.2 in /w`, `session s1, pid 42, ${URL}`, 'Cursor sync off. Click to open a view.'])
  const older = statusOf(running(URL, info(PROTOCOL - 1)), INST, undefined, 1, true).tooltip
  assert.match(older, /runs pcbjs 0\.0\.1-beta\.1, older than the extension/)
  assert.match(older, /Click to restart it\.$/)
  const failed = statusOf({ kind: 'failed', reason: 'gone', log: ['a', 'b'] }, INST, undefined, 0, true).tooltip.split('\n')
  assert.deepEqual(failed.slice(1), ['failed: gone', '  a', '  b', 'Click to open the session log.'])
  assert.match(statusOf(running(URL, info()), INST, HOLD, 1, true).tooltip, /compiles once its block is clean/)
})
