import { resolve } from 'node:path'
// Board facts: one object per set of compiled boards, the boards of a file, its innermost range, routes, findings and parts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardFacts, sameFile } from '../dist/facts.js'

const ROOT = resolve('/p')
const FILE = resolve('/p/pcb.tsx')

/** A board drawn from pcb.tsx: R1 at line 3, a route by `chain` at line 2, two findings and an instance member A/R01. */
function site(name = 'b', extra = {}) {
  return {
    name,
    layers: [{ name: 'F.Cu' }, { name: 'B.Cu' }],
    footprints: [
      { ref: 'R1', pads: [{ num: '1', name: '1', net: 'SIG' }], src: { file: 'pcb.tsx', line: 3, col: 21 } },
      { ref: 'R7', pads: [{ num: '1', name: '1', net: 'GND' }] },
    ],
    items: [
      { id: 1, uid: 'item:a', kind: 'pad', ref: 'R1', net: 'SIG' },
      { id: 2, uid: 'item:b', kind: 'track', net: 'SIG', width: 0.2, route: 'route:0' },
    ],
    sources: {
      'pcb.tsx': [
        { start: [3, 1], end: [3, 44], uids: ['item:a', 'item:b'], refs: ['R1'] },
        { start: [3, 21], end: [3, 37], uids: ['item:a'], refs: ['R1'] },
      ],
    },
    routes: [{ id: 'route:0', net: 'SIG', length: 4.2, call: { file: 'pcb.tsx', line: 2, col: 12 }, src: { file: 'pcb.tsx', line: 3, col: 1 } }],
    drc: [
      { severity: 'error', rule: 'clearance', message: 'too close', src: [{ file: 'pcb.tsx', start: [3, 21], end: [3, 21] }] },
      { severity: 'warning', rule: 'silk', message: 'over pad', src: [{ file: 'pcb.tsx', start: [3, 1], end: [3, 5] }] },
    ],
    erc: [],
    schematic: { parts: [{ ref: 'R7', path: ['A'], local: 'R01' }], circuits: [{ path: ['A'], binding: 'a' }] },
    ...extra,
  }
}

test('facts: the boards of a file and its innermost range, the boards of another root left out', () => {
  const mine = { root: ROOT, site: site('b') }
  const other = { root: '/q', site: site('c') }
  const f = boardFacts([mine, other]).forFile(FILE)
  assert.deepEqual(
    f.boards.map(b => b.ref.site.name),
    ['b'],
  )
  assert.deepEqual(
    f.all.map(b => b.site.name),
    ['b'],
  )
  const at = f.rangeAt({ line: 2, character: 25 })
  assert.deepEqual(at.range.start, [3, 21], 'the innermost of the two ranges around the cursor')
  assert.equal(f.rangeAt({ line: 2, character: 2 }).range.start[1], 1)
  assert.equal(f.rangeAt({ line: 0, character: 0 }), undefined)
  assert.equal(f.rangeAt({ line: 2, character: 25 }, []), undefined, 'on no board')
  assert.equal(boardFacts([other]).forFile(FILE).all.length, 1, 'every board when none holds the file')
})

test('source identity accepts native and Vite paths, with platform case rules', () => {
  const vite = FILE.replaceAll('\\', '/')
  assert.equal(sameFile(ROOT, 'pcb.tsx', FILE), true)
  assert.equal(sameFile(ROOT, vite, FILE), true)
  assert.equal(sameFile(ROOT, vite.toUpperCase(), FILE), process.platform === 'win32')
  assert.equal(sameFile(ROOT, 'other.tsx', FILE), false)
})
