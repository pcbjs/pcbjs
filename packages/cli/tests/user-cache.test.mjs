// The user-level model cache under meshFor: one conversion linked into two projects, the read-only fallback, and model cache ls, prune and path.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { meshKey } from '@pcbjs/step'
import { meshFor, modelsDir } from '../dist/project/models.js'
import { modelCache } from '../dist/model-cache.js'

const PIN = fileURLToPath(new URL('../../step/tests/fixtures/pin.step', import.meta.url))

async function withCache(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-user-cache-'))
  const had = process.env.PCBJS_CACHE_DIR
  process.env.PCBJS_CACHE_DIR = join(dir, 'cache')
  try {
    return await fn(dir, join(dir, 'cache'))
  } finally {
    if (had === undefined) delete process.env.PCBJS_CACHE_DIR
    else process.env.PCBJS_CACHE_DIR = had
    chmodSync(dir, 0o700)
    rmSync(dir, { recursive: true, force: true })
  }
}

function project(dir, name) {
  const root = join(dir, name)
  mkdirSync(root)
  const file = join(root, 'pin.step')
  copyFileSync(PIN, file)
  return { root, file, hash: meshKey(new Uint8Array(readFileSync(file))) }
}

test('a conversion is cached once and linked into two projects', () =>
  withCache(async (dir, cache) => {
    const a = project(dir, 'a'),
      b = project(dir, 'b')
    const bin = await meshFor(a.hash, a.file, modelsDir(a.root))
    // b's source is gone, so its mesh can only come from the user cache
    rmSync(b.file)
    const again = await meshFor(b.hash, b.file, modelsDir(b.root))
    assert.deepEqual(Buffer.from(again), Buffer.from(bin))
    const shared = join(cache, 'meshes', `${a.hash}.bin`)
    const inodes = [shared, join(modelsDir(a.root), `${a.hash}.bin`), join(modelsDir(b.root), `${b.hash}.bin`)].map(f => statSync(f).ino)
    if (process.platform !== 'win32') {
      assert.equal(new Set(inodes).size, 1)
      assert.equal(statSync(shared).nlink, 3)
    }
    const lines = []
    modelCache('ls', { log: l => lines.push(l) })
    assert.match(lines[0], /1 file, \d+\.\d kB$/)
    assert.match(lines[1], new RegExp(`meshes/${a.hash.slice(0, 12)}….bin  ${a.file.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}$`))
    lines.length = 0
    modelCache('path', { log: l => lines.push(l) })
    assert.deepEqual(lines, [cache])
    // a pruned cache leaves the projects their files
    lines.length = 0
    modelCache('prune', { all: true, log: l => lines.push(l) })
    assert.match(lines.at(-1), /^removed 1 file, .*; 0 files, 0\.0 kB kept/)
    assert.ok(statSync(join(modelsDir(b.root), `${b.hash}.bin`)).size > 0)
  }))

test('with a cache that cannot be written, the project cache alone serves, with one line saying so', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () =>
  withCache(async dir => {
    process.env.PCBJS_CACHE_DIR = join(dir, 'home', 'cache')
    mkdirSync(join(dir, 'home'))
    chmodSync(join(dir, 'home'), 0o500)
    const p = project(dir, 'p')
    const warned = [],
      warn = console.warn
    console.warn = l => warned.push(String(l))
    try {
      const bin = await meshFor(p.hash, p.file, modelsDir(p.root))
      assert.ok(bin.length > 0)
      rmSync(p.file)
      await meshFor(p.hash, p.file, modelsDir(p.root))
    } finally {
      console.warn = warn
      chmodSync(join(dir, 'home'), 0o700)
    }
    assert.equal(warned.length, 1)
    assert.match(warned[0], /^pcbjs: the model cache .* cannot be written \(EACCES\); models stay in each project's \.pcbjs\/models$/)
  }),
)
