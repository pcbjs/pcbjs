// The user-level model cache: its directory per platform and override, mode 0700, the index, and prune by age, by size and all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { cacheDirFor, cacheRows, cacheSize, latestOf, pruneCache, store, storeContent, userCache, viewOf } from '../dist/user-cache.js'

test('the directory per platform, with XDG_CACHE_HOME, LOCALAPPDATA and PCBJS_CACHE_DIR', () => {
  assert.equal(cacheDirFor({}, 'darwin', '/Users/a'), '/Users/a/Library/Caches/pcbjs')
  assert.equal(cacheDirFor({}, 'linux', '/home/a'), '/home/a/.cache/pcbjs')
  assert.equal(cacheDirFor({ XDG_CACHE_HOME: '/var/cache/a' }, 'linux', '/home/a'), '/var/cache/a/pcbjs')
  assert.equal(cacheDirFor({ XDG_CACHE_HOME: 'relative' }, 'linux', '/home/a'), '/home/a/.cache/pcbjs')
  assert.equal(cacheDirFor({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Local\\pcbjs')
  assert.equal(cacheDirFor({}, 'win32', 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Local\\pcbjs')
  assert.equal(cacheDirFor({ PCBJS_CACHE_DIR: 'ci-cache', XDG_CACHE_HOME: '/x' }, 'linux', '/home/a'), resolve('ci-cache'))
})

function withCache(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-user-cache-'))
  const had = process.env.PCBJS_CACHE_DIR
  process.env.PCBJS_CACHE_DIR = join(dir, 'cache')
  try {
    return fn(join(dir, 'cache'), dir)
  } finally {
    if (had === undefined) delete process.env.PCBJS_CACHE_DIR
    else process.env.PCBJS_CACHE_DIR = had
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the cache is made with mode 0700 and stores bytes with an index of source, options, size and use', () =>
  withCache((cache, dir) => {
    assert.equal(userCache(), cache)
    if (process.platform !== 'win32') assert.equal(statSync(cache).mode & 0o777, 0o700)
    store('meshes/a.bin', new Uint8Array(10), { source: '/p/a.step', options: { converter: 1 } })
    const index = JSON.parse(readFileSync(join(cache, 'index.json'), 'utf8'))
    assert.equal(index.entries['meshes/a.bin'].source, '/p/a.step')
    assert.equal(index.entries['meshes/a.bin'].size, 10)
    assert.ok(index.entries['meshes/a.bin'].used > 0)
    const dest = join(dir, 'project', '.pcbjs', 'models', 'a.bin')
    assert.ok(viewOf('meshes/a.bin', dest))
    assert.equal(statSync(dest).size, 10)
    assert.equal(viewOf('meshes/none.bin', join(dir, 'none.bin')), false)
  }))

test('prune by age, then to a size with the least recently used first, then all', () =>
  withCache(cache => {
    const day = 86400_000,
      now = Date.now()
    for (const [k, size] of [
      ['meshes/old.bin', 100],
      ['meshes/mid.bin', 300_000],
      ['meshes/new.bin', 400_000],
      ['fetched/lcsc/C1.step', 5],
    ])
      store(k, new Uint8Array(size), { source: k })
    // ages by the index: old 40 days, mid 10, new 1, C1 now
    const file = join(cache, 'index.json'),
      index = JSON.parse(readFileSync(file, 'utf8'))
    index.entries['meshes/old.bin'].used = now - 40 * day
    index.entries['meshes/mid.bin'].used = now - 10 * day
    index.entries['meshes/new.bin'].used = now - day
    writeFileSync(file, JSON.stringify(index))
    assert.equal(cacheRows(cache).length, 4)

    let r = pruneCache({ older: 30, now }, cache)
    assert.deepEqual(
      r.removed.map(x => x.key),
      ['meshes/old.bin'],
    )
    assert.equal(existsSync(join(cache, 'meshes', 'old.bin')), false)

    r = pruneCache({ maxSize: 0.5, now }, cache)
    assert.deepEqual(
      r.removed.map(x => x.key),
      ['meshes/mid.bin'],
    )
    assert.equal(cacheSize(cache), 400_005)

    r = pruneCache({ all: true, now }, cache)
    assert.equal(r.kept.length, 0)
    assert.equal(cacheRows(cache).length, 0)
    assert.deepEqual(JSON.parse(readFileSync(join(cache, 'index.json'), 'utf8')).entries, {})
  }))

test('content of a source is keyed by its hash: new content gets its own key and becomes the latest, the old file stays', () =>
  withCache(cache => {
    const src = 'https://x.org/m.step',
      bytes = s => new TextEncoder().encode(`ISO-10303-21; ${s}`)
    const a = storeContent('fetched', bytes('a'), '.step', { source: src })
    assert.match(a, /^fetched\/[0-9a-f]{64}\.step$/)
    assert.equal(latestOf('fetched', src), a)
    const b = storeContent('fetched', bytes('b'), '.step', { source: src })
    assert.notEqual(b, a)
    assert.equal(latestOf('fetched', src), b)
    assert.ok(existsSync(join(cache, ...a.split('/'))))
    // the upstream going back to the first content makes it the latest again
    assert.equal(storeContent('fetched', bytes('a'), '.step', { source: src }), a)
    assert.equal(latestOf('fetched', src), a)
    assert.equal(latestOf('fetched', 'https://x.org/other.step'), null)
    assert.equal(latestOf('downloads', src), null)
  }))
