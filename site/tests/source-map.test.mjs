import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourceIndex } from '@pcbjs/export/internal/site-data'
import { sourceMap } from '../scripts/source-map.mjs'

test('hero source mapping resolves UID ranges to actual sparse SVG IDs while retaining frame UIDs and footprint refs', () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-hero-map-'))
  const entry = join(root, 'pcb.tsx')
  writeFileSync(entry, 'route(A).H(9)\n<text>hello</text>\n<R1 />\n')
  const src = line => ({ file: entry, line, col: 1, endLine: line, endCol: line === 1 ? 13 : line === 2 ? 18 : 6 })
  const board = {
    // IDs deliberately differ from array position, and UID lexical order differs from array order.
    items: [
      { id: 42, uid: 'z-track', kind: 'track', net: 'SIG', src: { ...src(1), seg: 'H 9' } },
      { id: 7, uid: 'a-track', kind: 'via', net: 'SIG', src: { ...src(1), seg: 'H 9' } },
      { id: 91, uid: 'text-one', kind: 'text', text: 'hello', layer: 'F.SilkS', src: src(2) },
    ],
    footprints: [{ ref: 'R1', src: src(3) }],
  }
  try {
    const raw = sourceIndex(board, () => 'pcb.tsx')['pcb.tsx']
    assert.equal(raw[0].ids, undefined, 'the upstream contract is UID-only')
    const result = sourceMap(board, entry, root)
    assert.equal(result.file, 'pcb.tsx')
    assert.deepEqual(result.ranges[0].uids, ['a-track', 'z-track'])
    assert.deepEqual(result.ranges[0].ids, [7, 42], 'SVG highlighting retains both actual item IDs')
    assert.equal(result.ranges[0].chip, 'route SIG · H 9')
    assert.deepEqual(result.ranges[1].ids, [91])
    assert.equal(result.ranges[1].chip, 'text hello')
    assert.deepEqual(result.ranges[2].refs, ['R1'])
    assert.deepEqual(result.ranges[2].ids, [], 'footprint-only range remains addressable by ref')
    assert.equal(result.ranges[2].chip, 'R1')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
