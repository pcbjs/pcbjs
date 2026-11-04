import { resolve } from 'node:path'
// Board facts: one object per set of compiled boards, the boards of a file, its innermost range, routes, findings and parts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardFacts, itemsOf } from '../dist/facts.js'
import { docOf } from '../dist/doc.js'

const ROOT = resolve('/p')
const FILE = resolve('/p/pcb.tsx')
const TEXT = `const R1 = R0603('1k')
const ch = chain(SIG, J1[3], U2.IN)
export default <PCB><R1 at="5 5" /></PCB>
`

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

test('facts: one object while the boards stay, a new one when a board changes, every file computed once', () => {
  const s = site()
  const a = boardFacts([{ root: ROOT, site: s }])
  assert.equal(boardFacts([{ root: ROOT, site: s }]), a, 'a new list of the same boards')
  assert.equal(a.forFile(FILE), a.forFile(FILE))
  const b = boardFacts([{ root: ROOT, site: site() }])
  assert.notEqual(b, a)
  assert.equal(itemsOf(s), itemsOf(s), 'items by uid once per board')
  assert.equal(itemsOf(s).get('item:b').width, 0.2)
})

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

test('facts: routes and findings at an element, a point finding spread over its range, markers each once', () => {
  const s = site()
  const facts = boardFacts([
    { root: ROOT, site: s },
    { root: ROOT, site: { ...site('t'), variant: { name: 'lite' } } },
  ])
  const f = facts.forFile(FILE)
  assert.deepEqual(
    f.routesAt([3, 1]).map(r => r.id),
    ['route:0', 'route:0'],
    'one per board',
  )
  assert.deepEqual(f.routesAt([3, 2]), [])
  const [point] = f.findingsAt([3, 21])
  assert.equal(point.rule, 'clearance')
  assert.deepEqual([point.endLine, point.endCol], [3, 37], 'the range that starts at the point')
  assert.equal(facts.markers().length, 2, 'the same finding of two targets once')
  assert.equal(f.markers(), f.markers())
})

test('facts: the routes a helper call made, its name, and parts by ref, by binding and by instance member', () => {
  const f = boardFacts([{ root: ROOT, site: site() }]).forFile(FILE)
  const doc = docOf(FILE, TEXT)
  const calls = f.callRoutes(doc)
  assert.equal(calls.length, 1)
  assert.equal(TEXT.slice(calls[0].at, calls[0].at + 5), 'chain')
  assert.equal(f.callRoutes(doc), calls, 'once per text')
  assert.deepEqual([...f.helpers(doc)], ['chain'])
  assert.deepEqual(
    f.routesOfCall(doc, TEXT.indexOf('J1[3]')).map(r => r.id),
    ['route:0'],
  )
  assert.deepEqual(f.routesOfCall(doc, 3), [])
  assert.deepEqual(
    f.parts('R1').map(p => p.fp.ref),
    ['R1'],
  )
  assert.deepEqual(
    f.parts('a.R01').map(p => p.fp.ref),
    ['R7'],
    'the instance by its binding',
  )
  assert.deepEqual(
    f.parts('A.R01').map(p => p.fp.ref),
    ['R7'],
    'the instance by its name',
  )
  assert.equal(f.parts('R1'), f.parts('R1'))
})

test('facts: the grid of a placement, with where its glyph leads', () => {
  const s = site('b', {
    edit: [{ grid: 'G', src: { at: { file: 'pcb.tsx', line: 3, col: 21 } } }],
    grids: [{ name: 'G', pitch: 2.54, origin: [0, 0], angle: 0, src: { file: 'pcb.tsx', line: 1, col: 1 } }],
  })
  const f = boardFacts([{ root: ROOT, site: s }]).forFile(FILE)
  assert.deepEqual(f.gridAt(3, 21), { project: '/p', board: 'b', grid: { name: 'G', pitch: 2.54, origin: [0, 0], angle: 0, at: { file: '/p/pcb.tsx', line: 1, col: 1 } } })
  assert.equal(f.gridAt(3, 1), null)
})
