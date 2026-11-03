// The platform: Node's by default, a memory one for the browser compile, and the JavaScript SHA-1 and POSIX paths it runs on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { posix } from 'node:path'
import { memoryPlatform, nodePlatform, platform, setPlatform } from '../dist/platform.js'
import { sha1 } from '../dist/sha1.js'
import { posixPath } from '../dist/posix.js'

test('sha1: the same hex as node:crypto for strings as UTF-8 and for bytes of every block boundary', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70000]) {
    const b = randomBytes(n)
    assert.equal(sha1(b), createHash('sha1').update(b).digest('hex'), `${n} bytes`)
  }
  for (const s of ['', 'abc', 'héllo € 𝄞', '﻿bom']) assert.equal(sha1(s), createHash('sha1').update(s).digest('hex'))
})

test('posix paths: resolve, join, dirname, basename, extname and relative as node:path/posix gives them', () => {
  const p = posixPath(() => '/project')
  const cases = [
    ['resolve', 'a/b', '../c'],
    ['resolve', '/x/y', './z/'],
    ['resolve', ''],
    ['resolve', '/a', '/b', 'c'],
    ['join', 'a', '', '../b/'],
    ['join', '/a/', 'b'],
    ['join', ''],
    ['join', '..', 'a'],
    ['dirname', '/a/b/'],
    ['dirname', 'a'],
    ['dirname', '/'],
    ['basename', '/a/b.tsx', '.tsx'],
    ['basename', '/a/b/'],
    ['extname', 'a/.rc'],
    ['extname', 'a/b.c.d'],
    ['relative', '/a/b/c', '/a/d'],
    ['relative', '/a', '/a'],
  ]
  for (const [f, ...a] of cases) assert.equal(p[f](...a), f === 'resolve' ? posix.resolve('/project', ...a) : posix[f](...a), `${f}(${a.join(', ')})`)
})

test('memory platform: files by path, folders from their files, null for a file that only has to exist, no store', () => {
  const p = memoryPlatform({ files: { '/project/a.txt': 'hi', '/project/m/x.step': null, '/project/m/y.bin': new Uint8Array([1, 2]) }, env: { K: 'v' } })
  assert.equal(p.name, 'browser')
  assert.equal(p.text('a.txt'), 'hi')
  assert.deepEqual([...p.read('/project/m/y.bin')], [1, 2])
  assert.equal(p.read('m/x.step'), null)
  assert.equal(p.exists('m/x.step'), true)
  assert.deepEqual(p.stat('m'), { file: false, dir: true, size: 0, mtime: 0 })
  assert.equal(p.stat('/project/m/y.bin').size, 2)
  assert.deepEqual(p.list('/project'), ['a.txt', 'm'])
  assert.equal(p.list('/nowhere'), null)
  assert.equal(p.env('K'), 'v')
  assert.equal(p.store, null)
  assert.equal(p.sha1('abc'), createHash('sha1').update('abc').digest('hex'))
})

test('platform: Node by default, the one set until it is cleared', () => {
  assert.equal(platform().name, 'node')
  assert.equal(
    nodePlatform()
      .text(new URL(import.meta.url).pathname)
      ?.includes('platform: Node by default'),
    true,
  )
  const mem = memoryPlatform()
  setPlatform(mem)
  try {
    assert.equal(platform(), mem)
  } finally {
    setPlatform(null)
  }
  assert.equal(platform().name, 'node')
})
