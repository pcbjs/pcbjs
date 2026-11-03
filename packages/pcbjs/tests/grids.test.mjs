// Grids: defineGrid, grid units for part and group positions under <PCB grid> and <g grid>, origins on coordinates, pads, footprint points
// and functions, a part's frame, the registry on the board, grid-frame and grid-cycle, and schematic grids with the number kept.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, bindRef, defineGrid, defineFootprint, Schematic, Sheet } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'
import { compileBoard } from '@pcbjs/compile'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 60, h: 40 })
const board = (props, ...children) => h(PCB, { name: 'Grids', ...props }, edge(), ...children)
const at = (b, ref) => b.footprints.find(f => f.ref === ref).at.map(v => Math.round(v * 1000) / 1000)
const rot = (b, ref) => Math.round(b.footprints.find(f => f.ref === ref).rot * 1000) / 1000
const resistor = name => {
  const { A, B } = nets()
  return bindRef(R0603('1k').connect({ 1: A, 2: B }), name)
}
const failure = fn => {
  try {
    fn()
  } catch (e) {
    return e
  }
  assert.fail('expected a compile error')
}

test('defineGrid: a name, a positive pitch in mm or units, whole minor factors, and the known options only', () => {
  const g = defineGrid('main', { pitch: '100mil', minor: [2, 5], angle: 45 })
  assert.equal(g.$$, 'grid')
  assert.equal(g.name, 'main')
  assert.throws(() => defineGrid('a b', { pitch: 1 }), /name/)
  assert.throws(() => defineGrid('g', { pitch: 0 }), /positive/)
  assert.throws(() => defineGrid('g', { pitch: 'wide' }), /pitch/)
  assert.throws(() => defineGrid('g', { pitch: 1, minor: 1.5 }), /minor/)
  assert.throws(() => defineGrid('g', { pitch: 1, step: 2 }), /unknown option step/)
  assert.throws(() => defineGrid('g', { pitch: 1, origin: 5 }), /origin/)
})

test('<PCB grid>: bare positions are pitches from the origin, explicit units stay, the rotation turns from the grid angle', () => {
  const R1 = resistor('R1'),
    R2 = resistor('R2'),
    R3 = resistor('R3')
  const G = defineGrid('main', { pitch: 2.54, origin: '1 1' })
  const b = compileBoard(board({ grid: G }, h(R1, { at: '2 3' }), h(R2, { at: '10mm 2 90' }), h(R3, { at: '0.5 0' })))
  assert.deepEqual(at(b, 'R1'), [6.08, 8.62])
  assert.deepEqual(at(b, 'R2'), [11, 6.08])
  assert.equal(rot(b, 'R2'), 90)
  assert.deepEqual(at(b, 'R3'), [2.27, 1])
  const turned = compileBoard(board({ grid: defineGrid('t', { pitch: 1, angle: 90 }) }, h(resistor('R4'), { at: '5 0 0' })))
  assert.deepEqual(at(turned, 'R4'), [0, -5])
  assert.equal(rot(turned, 'R4'), 90)
})

test('<g grid>: the grid attaches in the group frame, nests, and the innermost is in effect; routes and other copper stay in mm', () => {
  const R1 = resistor('R1'),
    R2 = resistor('R2')
  const G = defineGrid('g', { pitch: 2 })
  const H = defineGrid('h', { pitch: 1, origin: '1 0' })
  const b = compileBoard(board({}, h('g', { name: 'Bank', at: '10 10', grid: G }, h(R1, { at: '1 1' }), h('g', { at: '2 0', grid: H }, h(R2, { at: '3 0' })))))
  assert.deepEqual(at(b, 'R1'), [12, 12])
  assert.deepEqual(at(b, 'R2'), [18, 10])
  assert.deepEqual(
    b.grids.map(g => [g.name, g.origin, g.used]),
    [
      ['g', [10, 10], ['R1']],
      ['h', [15, 10], ['R2']],
    ],
  )
  const node = b.edit.find(e => e.ref === 'R2')
  assert.equal(node.grid, 'h')
  assert.deepEqual(node.caps, ['placed', 'layered'])
})

test('origins: a pad handle and a footprint point of a part placed before or after, and a function of the placed parts', () => {
  const Pt = defineFootprint(
    function Pt(props) {
      return h('footprint', props, h('pad', { num: 1, at: '-1 0', size: 0.6, type: 'smd' }), h('pad', { num: 2, at: '1 0', size: 0.6, type: 'smd' }))
    },
    { pins: ['1', '2'], prefix: 'U', points: { tip: [3, 0] } },
  )
  const { A, B } = nets()
  const U1 = bindRef(Pt().connect({ 1: A, 2: B }), 'U1')
  const R1 = resistor('R1'),
    R2 = resistor('R2'),
    R3 = resistor('R3')
  const byPad = defineGrid('pad', { pitch: 1, origin: U1[2] })
  const byPoint = defineGrid('point', { pitch: 1, origin: U1.points.tip })
  const byFn = defineGrid('fn', { pitch: 1, origin: r => `${r.part(U1).at[0]} 20` })
  const b = compileBoard(
    board({}, h('g', { grid: byPad }, h(R1, { at: '0 2' })), h(U1, { at: '20 10' }), h('g', { grid: byPoint }, h(R2, { at: '0 0' })), h('g', { grid: byFn }, h(R3, { at: '1 0' }))),
  )
  assert.deepEqual(at(b, 'R1'), [21, 12])
  assert.deepEqual(at(b, 'R2'), [23, 10])
  assert.deepEqual(at(b, 'R3'), [21, 20])
})

test('frame: a grid adopts the placed frame of a part, its rotation and side, and a <g> under it takes no at', () => {
  const U1 = resistor('U1'),
    R1 = resistor('R1')
  const F = defineGrid('frame', { pitch: 1, frame: U1 })
  const b = compileBoard(board({}, h(U1, { at: '20 10 90' }), h('g', { grid: F }, h(R1, { at: '2 0' }))))
  assert.deepEqual(at(b, 'R1'), [20, 8])
  assert.equal(rot(b, 'R1'), 90)
  assert.equal(b.grids[0].frame, 'U1')
  const e = failure(() => compileBoard(board({}, h(U1, { at: '20 10' }), h('g', { grid: F, at: '1 1' }, h(R1, { at: '2 0' })))))
  assert.equal(e.code, 'grid-frame')
})

test('grid-cycle: a part placed under the grid its origin reads, through the dependency graph', () => {
  const U1 = resistor('U1'),
    R1 = resistor('R1')
  const G = defineGrid('loop', { pitch: 1, origin: U1[1] })
  const e = failure(() => compileBoard(board({ grid: G }, h(U1, { at: '5 5' }), h(R1, { at: '1 1' }))))
  assert.equal(e.name, 'CycleError')
  assert.equal(e.code, 'grid-cycle')
  assert.match(e.message, /^a grid cycle: U1 → loop \(.*grids\.test\.mjs:\d+:\d+\) → U1$/)
  const inner = failure(() => compileBoard(board({}, h(R1, { at: '1 1' }), h('g', { grid: G }, h(U1, { at: '5 5' })))))
  assert.equal(inner.code, 'grid-cycle')
  const missing = failure(() => compileBoard(board({}, h('g', { grid: defineGrid('lost', { pitch: 1, origin: resistor('Q9')[1] }) }, h(R1, { at: '1 1' })))))
  assert.match(missing.message, /Q9/)
})

test('the registry: attached grids and <PCB grids> on the board model, names unique per board', () => {
  const R1 = resistor('R1')
  const G = defineGrid('main', { pitch: '50mil', minor: 2 })
  const spare = defineGrid('spare', { pitch: 5, origin: '3 4' })
  const b = compileBoard(board({ grid: G, grids: [spare] }, h(R1, { at: '4 4' })))
  assert.deepEqual(
    b.grids.map(g => [g.name, g.pitch, g.minor, g.origin, g.used]),
    [
      ['main', 1.27, [2], [0, 0], ['R1']],
      ['spare', 5, [], [3, 4], []],
    ],
  )
  assert.ok(b.grids[0].src?.file, 'the defineGrid call')
  const twice = failure(() => compileBoard(board({}, h('g', { grid: spare }, h(R1, { at: '1 1' })), h('g', { grid: spare }))))
  assert.match(twice.message, /two grids are named spare/)
  assert.equal(compileBoard(board({}, h(resistor('R5'), { at: '1 1' }))).grids, undefined)
})

test('schematic grids: a grid object or the number, a sheet in a whole multiple of it, and no origin on a schematic grid', () => {
  const { A, B } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: B }), 'R1')
  const sch = grid => compileBoard(board({ schematic: { drawing: h(Schematic, { grid }, h(R1, { at: '4 4' })) } }, h(R1, { at: '10 10' }))).schematic.drawing
  const fine = sch(defineGrid('fine', { pitch: 1.27 }))
  const number = sch(1.27)
  assert.deepEqual(
    fine.symbols.map(s => s.at),
    number.symbols.map(s => s.at),
  )
  assert.throws(() => sch(defineGrid('off', { pitch: 1, origin: '1 1' })), /does not take/)
})

test('group rotation pivot is its attached grid origin after nested placement rotation, translation and side transform', () => {
  const G = defineGrid('pivot', { pitch: 1, origin: '2 3' })
  const src = { file: 'pcb.tsx', line: 7, col: 3 }
  for (const side of ['F', 'B']) {
    const b = compileBoard(board({}, h('g', { name: 'Outer', at: '20 15 90', side }, h('g', { name: 'Inner', at: '4 1 90', grid: G, __src: src }, h(resistor('R1'), { at: '0 0' })))))
    const node = b.edit.find(n => n.ref === 'Outer/Inner')
    assert.deepEqual(node.pivot, b.grids[0].origin)
    assert.deepEqual(node.pivot, at(b, 'R1'))
    assert.notDeepEqual(node.pivot, node.at.slice(0, 2))
  }
})


test('placement grid persists editing pitch and bounds without changing geometry or named group contents', () => {
  const G = defineGrid('inside', { pitch: 2.54, minor: [2, 5], maxLevel: 1 })
  const R1 = resistor('R1')
  const build = snap => compileBoard(board({}, h('g', { name: 'Bank', at: '10 10 90', side: 'B', grid: { ...G, ...(snap ? { snap: 0.5, maxLevel: 0 } : {}) } }, h(R1, { at: '2 3', ...(snap ? { grid: { snap: '0.25mm', maxLevel: 3 } } : {}) }))))
  const before = build(false), after = build(true)
  assert.deepEqual(at(after, 'R1'), at(before, 'R1'))
  assert.equal(rot(after, 'R1'), rot(before, 'R1'))
  assert.deepEqual(after.edit.find(n => n.ref === 'Bank').snap, { pitch: 0.5, maxLevel: 0 })
  assert.deepEqual(after.edit.find(n => n.ref === 'R1').snap, { pitch: 0.25, maxLevel: 3 })
  assert.equal(after.grids[0].pitch, 2.54)
  assert.equal(after.grids[0].maxLevel, 1)
  assert.throws(() => defineGrid('bad', { pitch: 1, maxLevel: -1 }), /maxLevel/)
  assert.throws(() => defineGrid('bad', { pitch: 1, maxLevel: 1.5 }), /maxLevel/)
  assert.throws(() => compileBoard(board({}, h(resistor('Bad'), { at: '1 2', grid: { snap: 0 } }))), /positive/)
})
