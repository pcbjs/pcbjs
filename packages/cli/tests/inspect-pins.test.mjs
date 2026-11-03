// inspect of a part prints its pin table, number, name and net, the table a hover of the part shows: Blinky's J1 in the demo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')

test("inspect J1 on Blinky: each pad's number, pin name and net", { timeout: 240000 }, () => {
  const run = mkdtempSync(join(tmpdir(), 'pcbjs-pins-'))
  try {
    const r = spawnSync(process.execPath, [BIN, 'inspect', 'blinky.pcb.tsx', 'J1', '--fresh'], {
      cwd: join(REPO, 'examples', 'demo'),
      env: { ...process.env, XDG_RUNTIME_DIR: run },
      encoding: 'utf8',
      timeout: 200000,
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const rows = r.stdout
      .split('\n')
      .map(l => l.trim().split(/\s+/))
      .filter(c => /^(pad|[123])$/.test(c[0]) && c.length > 3)
      .map(c => c.slice(0, 3))
    assert.deepEqual(rows, [
      ['pad', 'name', 'net'],
      ['1', '1', 'GND'],
      ['2', '2', 'VCC'],
      ['3', '3', 'SIG'],
    ])
  } finally {
    rmSync(run, { recursive: true, force: true })
  }
})
