// The viewer's source resolver, imported straight from the client TypeScript: Node strips the types itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { definitionOf, fileKey, itemsIn, openQuery, placementOf, rangeFor, rangeLabel, refsOfUids, repoUrl, resolveCursor, resolveItem, sourceTarget } from '../src/source.ts'

const outer = { start: [12, 3], end: [40, 10], uids: ['item:1', 'item:2', 'item:3', 'item:4'], refs: ['J1', 'D1'] }
const j1 = { start: [18, 5], end: [18, 92], uids: ['item:1', 'item:2', 'item:3'], refs: ['J1'] }
const ch = { start: [21, 5], end: [21, 60], uids: ['item:4'], refs: ['D1'] }
const inner = { start: [21, 20], end: [21, 30], uids: ['item:4'], refs: [] }
const lib = { start: [3, 1], end: [9, 2], uids: ['item:4'], refs: ['D1'] }
const sources = { 'main.tsx': [outer, j1, ch, inner], 'lib/MyGroup.tsx': [lib] }
// the rows of this view, by id, each with its uid
const items = [1, 2, 3, 4, 5].map(id => ({ id, uid: `item:${id}` }))

test('an item resolves to the smallest range that lists it', () => {
  assert.deepEqual(rangeFor(sources, { uid: 'item:2' }), { file: 'main.tsx', range: j1 })
  assert.deepEqual(rangeFor(sources, { uid: 'item:4' }), { file: 'main.tsx', range: inner })
  assert.deepEqual(rangeFor(sources, { ref: 'D1' }), { file: 'main.tsx', range: ch })
  assert.equal(rangeFor(sources, { uid: 'item:99' }), null)
  assert.equal(rangeFor(undefined, { uid: 'item:1' }), null)
})

test('resolveItem tries the uid of the id, then the ref', () => {
  assert.equal(resolveItem({ sources, items }, { id: 99, ref: 'J1' })?.range, j1)
  assert.equal(resolveItem({ sources, items }, { id: 4, ref: 'J1' })?.range, inner)
  assert.equal(resolveItem({}, { id: 1, ref: 'J1' }), null)
})

test('a cursor resolves to the innermost range and everything nested in it', () => {
  const hit = resolveCursor(sources, 'main.tsx', 18, 40)
  assert.equal(hit.range, j1)
  assert.deepEqual(hit.uids, ['item:1', 'item:2', 'item:3'])
  assert.deepEqual(hit.refs, ['J1'])
  const mid = resolveCursor(sources, 'main.tsx', 21, 10)
  assert.equal(mid.range, ch)
  const top = resolveCursor(sources, 'main.tsx', 30, 1)
  assert.equal(top.range, outer)
  assert.deepEqual(top.uids.sort(), ['item:1', 'item:2', 'item:3', 'item:4'])
  assert.deepEqual(top.refs.sort(), ['D1', 'J1'])
  assert.equal(resolveCursor(sources, 'main.tsx', 21, 25).range, inner)
})

test('range edges: a cursor right before the first character or right after the last is outside', () => {
  // j1 runs from its < at 18:5 to its > at 18:92; a cursor at column c sits just before character c
  assert.equal(resolveCursor(sources, 'main.tsx', 18, 5).range, outer)
  assert.equal(resolveCursor(sources, 'main.tsx', 18, 6).range, j1)
  assert.equal(resolveCursor(sources, 'main.tsx', 18, 92).range, j1)
  assert.equal(resolveCursor(sources, 'main.tsx', 18, 93).range, outer)
  assert.equal(resolveCursor(sources, 'main.tsx', 12, 3), null)
  assert.equal(resolveCursor(sources, 'main.tsx', 40, 10).range, outer)
  assert.equal(resolveCursor(sources, 'main.tsx', 40, 11), null)
  // a start-only position holds no cursor
  assert.equal(resolveCursor({ 'a.tsx': [{ start: [2, 3], end: [2, 3], uids: ['item:1'], refs: [] }] }, 'a.tsx', 2, 3), null)
  assert.equal(resolveCursor({ 'a.tsx': [{ start: [2, 3], end: [2, 3], uids: ['item:1'], refs: [] }] }, 'a.tsx', 2, 4), null)
  assert.equal(resolveCursor(sources, 'main.tsx', 41, 1), null)
  assert.equal(resolveCursor(sources, 'main.tsx', 1, 1), null)
})

test('cursor files: unknown files, absolute paths and Windows separators', () => {
  assert.equal(resolveCursor(sources, 'other.tsx', 18, 10), null)
  assert.equal(resolveCursor(undefined, 'main.tsx', 18, 10), null)
  assert.equal(fileKey(sources, '/home/me/demo/main.tsx'), 'main.tsx')
  assert.equal(fileKey(sources, 'C:\\demo\\lib\\MyGroup.tsx'), 'lib/MyGroup.tsx')
  assert.equal(fileKey(sources, './main.tsx'), 'main.tsx')
  assert.equal(fileKey(sources, '/x/notmain.tsx'), null)
  assert.equal(resolveCursor(sources, '/abs/lib/MyGroup.tsx', 5, 1).range, lib)
})

test('itemsIn unions nested ranges only', () => {
  assert.deepEqual(itemsIn([outer, j1, ch], ch), { uids: ['item:4'], refs: ['D1'] })
})

test('repository URLs per host', () => {
  const r = { start: [18, 5], end: [20, 2] }
  const repo = (kind, dir = '') => ({ url: 'https://host/org/name/', kind, ref: 'main', dir })
  assert.equal(repoUrl(repo('github', 'examples/demo/'), 'main.tsx', r), 'https://host/org/name/blob/main/examples/demo/main.tsx#L18-L20')
  assert.equal(repoUrl(repo('gitlab'), 'lib/a.tsx', r), 'https://host/org/name/-/blob/main/lib/a.tsx#L18-20')
  assert.equal(repoUrl(repo('gitea'), 'main.tsx', r), 'https://host/org/name/src/main/main.tsx#L18-L20')
  assert.equal(repoUrl(repo('bitbucket'), 'main.tsx', r), 'https://host/org/name/src/main/main.tsx#lines-18:20')
  assert.equal(repoUrl({ ...repo('github'), ref: 'feat/x' }, 'main.tsx', r), 'https://host/org/name/blob/feat/x/main.tsx#L18-L20')
  assert.equal(repoUrl(repo('generic', 'pcb/'), 'main.tsx', r), 'https://host/org/name/pcb/main.tsx#L18')
})

test('open query and range label', () => {
  assert.equal(openQuery('main.tsx', j1), 'file=main.tsx&line=18&col=5&endLine=18&endCol=92')
  assert.equal(openQuery('lib/a b.tsx', { start: [3, 1] }), 'file=lib%2Fa+b.tsx&line=3&col=1')
  assert.equal(rangeLabel('main.tsx', j1), 'main.tsx:18:5 to 18:92')
  assert.equal(rangeLabel('main.tsx', { start: [3, 1], end: [3, 1] }), 'main.tsx:3:1')
})

test('refsOfUids reads the refs of uids from the item rows', () => {
  const items = [
    { id: 1, uid: 'item:1', kind: 'pad', ref: 'J1', layers: ['F.Cu'] },
    { id: 7, uid: 'item:7', kind: 'track', net: 'GND', layers: ['F.Cu'] },
    { id: 9, uid: 'item:9', kind: 'graphic', ref: 'R&1', layers: ['F.SilkS'] },
  ]
  assert.deepEqual([...refsOfUids({ items }, ['item:1', 'item:7', 'item:9'])].sort(), ['J1', 'R&1'])
  assert.deepEqual([...refsOfUids({ items }, [])], [])
})

test('cmd+click: a footprint item opens its placement, shift the innermost range, other items their own range', () => {
  // D1 is placed by the channel call on line 21 of main.tsx and drawn by lib/MyGroup.tsx; item 4 is its pad, item 5 a track with no footprint
  const pad = { start: [5, 7], end: [5, 40], uids: ['item:4'], refs: [] }
  const track = { start: [30, 3], end: [30, 50], uids: ['item:5'], refs: [] }
  const board = {
    items,
    sources: { 'main.tsx': [outer, ch, track], 'lib/MyGroup.tsx': [lib, pad] },
    footprints: [
      {
        ref: 'D1',
        src: { file: 'main.tsx', line: 21, col: 5, endLine: 21, endCol: 60 },
        def: { file: 'lib/MyGroup.tsx', line: 3, col: 1, endLine: 9, endCol: 2 },
      },
      { ref: 'U9', src: { file: 'main.tsx', line: 33, col: 5 } },
    ],
  }
  const at = t => t && `${t.file}:${t.start.join(':')}-${t.end ? t.end.join(':') : ''}`
  assert.deepEqual(placementOf(board, 'D1'), { file: 'main.tsx', start: [21, 5], end: [21, 60] })
  assert.deepEqual(placementOf(board, 'U9'), { file: 'main.tsx', start: [33, 5] })
  assert.equal(placementOf(board, 'nope'), null)
  assert.equal(at(definitionOf(board, 'D1')), 'lib/MyGroup.tsx:3:1-9:2')
  assert.equal(definitionOf(board, 'U9'), null)
  // without def the smallest range listing the ref would be the one-line call site, not the multi-line definition
  assert.equal(rangeFor(board.sources, { ref: 'D1' }).file, 'main.tsx')
  // a pad of D1 in 2D, and D1's body in 3D
  assert.equal(at(sourceTarget(board, { id: 4, ref: 'D1' })), 'main.tsx:21:5-21:60')
  assert.equal(at(sourceTarget(board, { id: 4, ref: 'D1' }, 'placement')), 'main.tsx:21:5-21:60')
  assert.equal(at(sourceTarget(board, { id: 4, ref: 'D1' }, 'definition')), 'lib/MyGroup.tsx:5:7-5:40')
  assert.equal(at(sourceTarget(board, { ref: 'D1' })), 'main.tsx:21:5-21:60')
  assert.equal(at(sourceTarget(board, { ref: 'D1' }, 'definition')), 'lib/MyGroup.tsx:3:1-9:2')
  // a track: both open its own range
  assert.equal(at(sourceTarget(board, { id: 5, ref: null })), 'main.tsx:30:3-30:50')
  assert.equal(at(sourceTarget(board, { id: 5, ref: null }, 'definition')), 'main.tsx:30:3-30:50')
  // a footprint with only a start position and no index range falls back to it either way
  assert.equal(at(sourceTarget(board, { ref: 'U9' }, 'definition')), 'main.tsx:33:5-')
  assert.equal(sourceTarget(board, { id: 99, ref: null }), null)
  assert.equal(sourceTarget({ footprints: [] }, { id: 1, ref: 'D1' }), null)
})
