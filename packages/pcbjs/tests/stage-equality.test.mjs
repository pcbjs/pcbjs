// The five-run equality of scripts/stage-equality.mjs on two small examples, each copied beside the others: cold, cancelled at every stage boundary and resumed, warm, from the route memos alone and with a corrupt object, all equal and the warm run all hits. CI runs it on every example.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const EXAMPLES = join(REPO, 'examples')

test('stage equality: four runs of usbc-led and highspeed agree, the warm one hitting every stage', { timeout: 600000 }, () => {
  const copies = ['usbc-led', 'highspeed'].map(e => {
    const dir = mkdtempSync(join(EXAMPLES, `.tmp-${e}-`))
    cpSync(join(EXAMPLES, e), dir, { recursive: true, filter: src => !/[\\/](\.pcbjs|shots|node_modules)$/.test(src) })
    return dir
  })
  try {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'stage-equality.mjs'), ...copies.map(d => basename(d))], { encoding: 'utf8', maxBuffer: 64 << 20 })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /every run of 2 boards agrees, the warm run all hits/)
  } finally {
    for (const d of copies) rmSync(d, { recursive: true, force: true })
  }
})
