// The default layer is an input of the compile: a default one entry's module sets changes the next entry's key, so B is never served stale.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB from '@pcbjs/core'
import { defineDefaultBoard, resetDefaults } from '@pcbjs/core/internal/defaults'
import { realm } from '@pcbjs/core/internal/realm'
import { compileStages, defaultsKey, exportsKey, servedStages } from '../dist/pipeline.js'

const board = () => h(PCB, { name: 'B' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 10, h: 10 }))
const files = { '/p/b.pcb.tsx': 'same' }
const hashOf = f => files[f] ?? (existsSync(f) ? createHash('sha1').update(readFileSync(f)).digest('hex') : 'missing')

test('a default set by entry A changes entry B: another key, never a stale board', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-realm-'))
  resetDefaults()
  try {
    const compileB = () => compileStages(board(), { cache: { dir, entry: 'b.pcb.tsx', files, env: '' } })[0].board.rev
    const served = () => servedStages(dir, 'b.pcb.tsx', { env: '', exports: exportsKey([]), defaults: defaultsKey(realm().defaults), hashOf })?.[0].board.rev ?? null
    assert.equal(compileB(), '')
    assert.equal(served(), '', 'unchanged, B is served from the cache')
    // what entry A's module does when it evaluates in the same process
    defineDefaultBoard({ rev: 'A-1' })
    assert.equal(served(), null, 'the default layer is in the key, so B evaluates again')
    assert.equal(compileB(), 'A-1')
    assert.equal(served(), 'A-1')
    assert.notEqual(defaultsKey(realm().defaults), defaultsKey(null))
  } finally {
    resetDefaults()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the compile takes its default layer from its options, the realm only when none is given', () => {
  resetDefaults()
  try {
    defineDefaultBoard({ rev: 'R' })
    assert.equal(compileStages(board(), { cache: false })[0].board.rev, 'R')
    assert.equal(compileStages(board(), { cache: false, defaults: null })[0].board.rev, '')
    assert.equal(compileStages(board(), { cache: false, defaults: { rev: 'O' } })[0].board.rev, 'O')
  } finally {
    resetDefaults()
  }
})
