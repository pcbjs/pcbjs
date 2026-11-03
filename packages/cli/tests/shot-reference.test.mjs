// `pcbjs shot` of Blinky in 2D, 3D and the schematic against the reference PNGs in fixtures/shots, by a tolerance that
// absorbs rasteriser and platform differences; PCBJS_UPDATE_SHOTS=1 writes the references again.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const BIN = join(REPO, 'packages', 'pcbjs', 'bin', 'pcbjs.js')
const REFS = join(HERE, 'fixtures', 'shots')
const out = mkdtempSync(join(tmpdir(), 'pcbjs-shot-ref-'))
after(() => rmSync(out, { recursive: true, force: true }))

/** mean absolute difference per channel, 0 to 255 */
const MEAN = 3
/** share of pixels whose largest channel difference passes 48 */
const SHARE = 0.03

async function pixels(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

test('Blinky in 2D, 3D and the schematic matches its references', { timeout: 300000 }, async () => {
  const r = spawnSync(process.execPath, [BIN, 'shot', 'blinky.pcb.tsx', '--view', '2d', '--view', '3d', '--view', 'sch', '--size', '320x240', '-o', out], {
    cwd: join(REPO, 'examples', 'demo'),
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  for (const view of ['2d', '3d', 'sch']) {
    const file = `Blinky-${view}.png`
    if (process.env.PCBJS_UPDATE_SHOTS) copyFileSync(join(out, file), join(REFS, file))
    const [a, b] = await Promise.all([pixels(join(out, file)), pixels(join(REFS, file))])
    assert.deepEqual([a.w, a.h], [b.w, b.h], file)
    let sum = 0,
      off = 0
    for (let i = 0; i < a.data.length; i += 4) {
      let worst = 0
      for (let k = 0; k < 4; k++) {
        const d = Math.abs(a.data[i + k] - b.data[i + k])
        sum += d
        worst = Math.max(worst, d)
      }
      if (worst > 48) off++
    }
    const mean = sum / a.data.length,
      share = off / (a.w * a.h)
    assert.ok(mean <= MEAN && share <= SHARE, `${file}: mean difference ${mean.toFixed(2)}, ${(share * 100).toFixed(1)}% of pixels off`)
  }
})
