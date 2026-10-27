// A draft compile reads the route file but never writes it; the next saved compile writes what it used.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RouteCache, clearRouteCache } from '../dist/route-cache.js'

const leg = obs => ({ obs, box: [0, 0, 1, 1], result: null })

test('route cache: a draft keeps its legs in memory and leaves the file alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-draft-cache-'))
  try {
    clearRouteCache()
    const file = join(dir, 'B.json')
    const saved = new RouteCache('B', '', dir)
    saved.putLeg('a', leg('1'))
    saved.commit()
    const before = readFileSync(file, 'utf8')

    const draft = new RouteCache('B', '', dir, true)
    assert.deepEqual(draft.leg('a'), leg('1'))
    draft.putLeg('b', leg('2'))
    draft.commit()
    assert.equal(readFileSync(file, 'utf8'), before)
    // the next compile finds both, the saved leg and the draft's
    const next = new RouteCache('B', '', dir)
    assert.deepEqual(next.leg('a'), leg('1'))
    assert.deepEqual(next.leg('b'), leg('2'))
    next.putLeg('a', leg('1'))
    next.commit()
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, 'utf8')).groups[''].legs), ['a'])
  } finally {
    clearRouteCache()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('route cache: a draft of a board never routed writes no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-draft-cache-'))
  try {
    clearRouteCache()
    const draft = new RouteCache('C', '', dir, true)
    draft.putLeg('a', leg('1'))
    draft.commit()
    assert.equal(existsSync(join(dir, 'C.json')), false)
  } finally {
    clearRouteCache()
    rmSync(dir, { recursive: true, force: true })
  }
})
