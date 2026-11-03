// Dependency cycles: a strongly connected component or a self edge is a compile error of its own code, naming each member by reference and source, and a cycle diagnostic in the report.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { checkCycles, cyclesOf, CycleError } from '@pcbjs/compile/internal/deps'
import { slotDiagnostics } from '@pcbjs/cli/internal/report'

const at = (line, file = '/p/pcb.tsx') => ({ file, line, col: 3 })
const node = (kind, ref, line) => ({ kind, ref, src: at(line) })
const thrown = g => {
  try {
    checkCycles(g)
  } catch (e) {
    return e
  }
  return null
}

test('cycles: an acyclic graph passes, and the components come out in graph order', () => {
  const g = {
    nodes: [node('part', 'U1', 1), node('route', 'route:1', 2), node('part', 'J1', 3)],
    edges: [
      [1, 0, 'end'],
      [1, 2, 'end'],
    ],
  }
  assert.equal(thrown(g), null)
  assert.deepEqual(
    cyclesOf({
      nodes: g.nodes,
      edges: [
        [0, 1],
        [1, 0],
        [2, 2],
      ],
    }),
    [[0, 1], [2]],
  )
})

test('grid-cycle: a part anchoring the grid it sits on', () => {
  const e = thrown({
    nodes: [node('grid', 'G1', 4), node('part', 'U1', 9)],
    edges: [
      [1, 0, 'on'],
      [0, 1, 'anchor'],
    ],
  })
  assert.ok(e instanceof CycleError)
  assert.equal(e.code, 'grid-cycle')
  assert.equal(e.message, 'a grid cycle: G1 (/p/pcb.tsx:4:3) → U1 (/p/pcb.tsx:9:3) → G1')
  assert.deepEqual(e.src, at(4))
})

test('follow-cycle: a follower whose pad is an end of the route it follows', () => {
  const e = thrown({
    nodes: [node('route', 'route:2', 6), node('follower', 'C3', 7)],
    edges: [
      [1, 0, 'follow'],
      [0, 1, 'end'],
    ],
  })
  assert.equal(e.code, 'follow-cycle')
  assert.deepEqual(
    e.members.map(m => m.ref),
    ['route:2', 'C3'],
  )
  assert.match(e.message, /^a follower cycle: route:2 \(\/p\/pcb\.tsx:6:3\) → C3 \(\/p\/pcb\.tsx:7:3\) → route:2$/)
})

test('solver-order: a solver reading its own result, a self edge', () => {
  const e = thrown({
    nodes: [node('part', 'R1', 2), node('solver', 'route:5', 11)],
    edges: [
      [1, 0, 'reads'],
      [1, 1, 'reads'],
    ],
  })
  assert.equal(e.code, 'solver-order')
  assert.equal(e.message, 'a solver reads its own result: route:5 (/p/pcb.tsx:11:3) → route:5')
})

test('reference-cycle: entries naming each other, and the cycle diagnostic of each code in the report', () => {
  const e = thrown({
    nodes: [node('reference', 'a', 1), node('reference', 'b', 5)],
    edges: [
      [0, 1],
      [1, 0],
    ],
  })
  assert.equal(e.code, 'reference-cycle')
  const cfg = { root: '/p' }
  const slot = { entry: { rel: 'pcb.tsx' }, compiled: null, conflict: null }
  for (const code of ['grid-cycle', 'follow-cycle', 'solver-order', 'reference-cycle']) {
    const [d] = slotDiagnostics(cfg, slot, new CycleError(code, [node('grid', 'G1', 4)]))
    assert.equal(d.kind, 'cycle')
    assert.equal(d.code, code)
    assert.deepEqual(d.src, { file: 'pcb.tsx', start: [4, 3], end: [4, 3], role: 'item' })
  }
})

test('cycles: a board of parts and routes compiles with its graph checked', () => {
  const b = compileBoard(h(PCB, { name: 'Plain' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 10, h: 10 })), { cache: false })
  assert.deepEqual(cyclesOf(b.deps), [])
})
