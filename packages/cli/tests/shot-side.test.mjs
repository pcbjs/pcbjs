// `pcbjs shot --side B` puts the back on top without mirroring, `--mirror` adds the mirror: three different 2D images of Blinky.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const DEMO = join(REPO, 'examples', 'demo')
const out = mkdtempSync(join(tmpdir(), 'pcbjs-shot-side-'))

after(() => rmSync(out, { recursive: true, force: true }))

function shoot(...flags) {
  const r = spawnSync(process.execPath, [BIN, 'shot', 'blinky.pcb.tsx', '--view', '2d', '--size', '400x250', '-o', out, ...flags], {
    cwd: DEMO,
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
}

test('shot --side B and --side B --mirror differ from each other and from --side F', { timeout: 300000 }, () => {
  shoot('--side', 'F')
  shoot('--side', 'B')
  shoot('--side', 'B', '--mirror')
  const [front, back, mirrored] = ['Blinky-2d.png', 'Blinky-2d-back.png', 'Blinky-2d-back-mirror.png'].map(f => readFileSync(join(out, f)))
  assert.ok(!back.equals(front), 'the back on top is not the front view')
  assert.ok(!mirrored.equals(front), 'the mirrored back is not the front view')
  assert.ok(!mirrored.equals(back), 'the mirror changes the back view')
})
