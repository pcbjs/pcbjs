import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { circuit, defineFootprint, h, keepout, layout, NC, nets, resetDefaults, route } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'

test('library layout retains effective parameters and restores shared placement under an own override', () => {
  resetDefaults()
  const Pad = defineFootprint(props => h('footprint', { ...props, bom: false }, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'TP' })
  const chan = circuit('channel', () => ({ R: Pad().connect({ 1: NC }) }))
  const CH1 = chan({}, 'CH1'), CH2 = chan({}, 'CH2')
  const Row = layout(chan, (g, { at, gap }) => h('g', { at }, h(g.R, { at: `${gap} 0`, __src: { file: 'shared.tsx', line: 3, col: 1, endLine: 3, endCol: 20 } })), 'Row')
  const root = h(PCB, { name: 'B' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 80, h: 30 }), h(Row, { g: CH1, at: '10 10', gap: 3 }, h(CH1.R, { at: '20 0' })), h(Row, { g: CH2, at: '40 10', gap: 7 }, h(CH2.R, { at: '25 0' })))
  const ordinary = compileBoard(root, { cache: false })
  const library = compileBoard(root, { cache: false, library: 'CH1' })
  const first = ordinary.schematic.circuits.find(c => c.name === 'CH1').parts[0]
  const second = ordinary.schematic.circuits.find(c => c.name === 'CH2').parts[0]
  assert.equal(ordinary.footprints.find(f => f.ref === first).at[0], 30)
  assert.equal(library.footprints.find(f => f.ref === first).at[0], 13, 'effective gap=3 remains, own at=20 is removed')
  assert.equal(library.footprints.find(f => f.ref === second), undefined, 'other instance never reaches library routing')
  assert.equal(library.edit.find(n => n.ref === first).owned, undefined)
  assert.equal(library.footprints.find(f => f.ref === first).src.file, 'shared.tsx')
  assert.equal(ordinary.edit.find(n => n.ref === first).owned, 'CH1')
  assert.equal(compileBoard(root, { cache: false }).footprints.find(f => f.ref === first).at[0], 30, 'library compile does not mutate the tree')
})


test('library routing ignores board outlines, outside keepouts and other placed copies', () => {
  resetDefaults()
  const Pad = defineFootprint(props => h('footprint', { ...props, bom: false }, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'TP' })
  const { V } = nets()
  const chan = circuit('routed', ({ V }) => ({ A: Pad().connect({ 1: V }), B: Pad().connect({ 1: V }) }))
  const CH1 = chan({ V }, 'CH1'), CH2 = chan({ V }, 'CH2')
  const Row = layout(chan, (g, { at }) => h('g', { at }, h(g.A, { at: '0 0' }), h(g.B, { at: '10 0' }), route(g.A[1], g.B[1]).width(0.3).X()), 'Row')
  const root = (obstacle, other) => h(PCB, { name: 'Route' }, h('rect', { layer: 'Edge.Cuts', x: -5, y: -5, w: other, h: 50 }), h(Row, { g: CH1, at: '10 10' }), h(Row, { g: CH2, at: `${other} 20` }), obstacle && keepout('M14 6H16V14H14Z'))
  const a = compileBoard(root(false, 50), { cache: false, library: 'CH1' })
  const b = compileBoard(root(true, 90), { cache: false, library: 'CH1' })
  assert.equal(a.routes.length, 1)
  assert.equal(b.routes.length, 1)
  assert.ok(a.items.some(it => it.kind === 'track'))
  const copper = board => board.items.filter(it => it.kind === 'track' || it.kind === 'via').map(({ src, chain, uid, ...it }) => it)
  assert.deepEqual(copper(a), copper(b))
  assert.deepEqual(a.outline, [])
  assert.deepEqual(b.keepouts ?? [], [])
  assert.equal(b.footprints.length, 2)
})


test('library references start at zero per prefix independently of the chosen instance', () => {
  resetDefaults()
  const pad = prefix => defineFootprint(props => h('footprint', { ...props, bom: false }, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix })
  const R = pad('R'), D = pad('D')
  const chan = circuit('channel', () => ({ R10: R().connect({ 1: NC }), R2: R().connect({ 1: NC }), D: D().connect({ 1: NC }) }))
  const CH1 = chan({}, 'CH1'), CH9 = chan({}, 'CH9')
  const Row = layout(chan, (g, { at }) => h('g', { at }, h(g.R10, { at: '0 0' }), h(g.R2, { at: '5 0' }), h(g.D, { at: '10 0' })), 'Row')
  const root = h(PCB, { name: 'B' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 80, h: 30 }), h(Row, { g: CH1, at: '10 10' }), h(Row, { g: CH9, at: '40 10' }))
  const labels = board => Object.fromEntries(board.footprints.map(fp => [board.schematic.parts.find(p => p.ref === fp.ref).local, fp.displayRef]))
  const a = compileBoard(root, { cache: false, library: 'CH1' })
  const b = compileBoard(root, { cache: false, library: 'CH9' })
  assert.deepEqual(labels(a), { R10: 'R1', R2: 'R0', D: 'D0' })
  assert.deepEqual(labels(b), labels(a))
  assert.notDeepEqual(a.footprints.map(f => f.ref), b.footprints.map(f => f.ref), 'selection identities still identify the right source instance')
  for (const board of [a, b]) {
    const silk = board.items.filter(it => it.kind === 'text' && it.layer.endsWith('SilkS'))
    assert.ok(silk.length >= 3)
    for (const fp of board.footprints) assert.ok(silk.some(it => it.ref === fp.ref && it.text === fp.displayRef), 'silk uses local labels and canonical ownership')
  }
  assert.ok(compileBoard(root, { cache: false }).footprints.every(fp => fp.displayRef === undefined), 'ordinary board numbering is unchanged')
})

test('library schematic contains only local circuit connectivity and zero-based symbol labels', () => {
  resetDefaults()
  const Pad = defineFootprint(props => h('footprint', { ...props, bom: false }, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'TP' })
  const { V, Outside } = nets()
  const chan = circuit('channel', ({ V }) => ({ A: Pad().connect({ 1: V }), B: Pad().connect({ 1: V }) }))
  const CH1 = chan({ V }, 'CH1'), CH2 = chan({ V }, 'CH2')
  const other = Pad({ ref: 'Outside' }).connect({ 1: Outside })
  const Row = layout(chan, (g, { at }) => h('g', { at }, h(g.A, { at: '0 0' }), h(g.B, { at: '10 0' })), 'Row')
  const root = h(PCB, { name: 'Schematic' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 100, h: 50 }), h(Row, { g: CH1, at: '10 10' }), h(Row, { g: CH2, at: '50 10' }), h(other, { at: '80 30' }))
  const library = compileBoard(root, { cache: false, library: 'CH2', want: ['meta', 'sch'] })
  const refs = new Set(library.footprints.map(f => f.ref))
  assert.equal(refs.size, 2)
  assert.deepEqual(library.schematic.circuits.map(c => c.path.join('/')), ['CH2'])
  assert.equal(library.schematic.nets.length, 1)
  assert.equal(library.schematic.nets[0].pins.length, 2, 'board port peers are removed before routing the schematic')
  assert.ok(library.schematic.nets[0].pins.every(p => [...refs].some(ref => p.startsWith(ref + '.'))))
  assert.deepEqual(library.schematic.drawing.symbols.map(s => s.displayRef).sort(), ['TP0', 'TP1'])
  assert.ok(library.schematic.drawing.symbols.every(s => refs.has(s.ref)), 'symbols retain canonical identities across views')
  const board = compileBoard(root, { cache: false, want: ['meta', 'sch'] })
  assert.equal(board.schematic.drawing.symbols.length, 5)
  assert.ok(board.schematic.drawing.symbols.every(s => s.displayRef === undefined))
})

test('library schematic numbers unplaced parts and renders private nets without the representative instance name', () => {
  resetDefaults()
  const Pad = defineFootprint(props => h('footprint', { ...props, bom: false }, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'TP' })
  const chan = circuit('channel', (_, { nets }) => {
    const { VCC } = nets
    return { A: Pad().connect({ 1: VCC }), B: Pad().connect({ 1: VCC }) }
  })
  const CH1 = chan({}, 'CH1'), CH2 = chan({}, 'CH200')
  const Row = layout(chan, (g, { at }) => h('g', { at }, h(g.B, { at: '10 0' })), 'Row')
  const root = h(PCB, { name: 'Partial' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 100, h: 50 }), h(Row, { g: CH1, at: '10 10' }), h(Row, { g: CH2, at: '50 10' }))
  const views = ['CH1', 'CH200'].map(library => compileBoard(root, { library, cache: false, want: ['meta', 'sch'] }))
  for (const board of views) {
    assert.deepEqual(board.schematic.parts.map(p => [p.local, p.displayRef, p.placed]), [['A', 'TP0', false], ['B', 'TP1', true]])
    assert.equal(board.footprints[0].displayRef, 'TP1', 'physical labels share numbering with unplaced schematic parts')
    assert.deepEqual(board.schematic.drawing.symbols.map(s => s.displayRef).sort(), ['TP0', 'TP1'])
    assert.equal(board.schematic.nets[0].displayName, 'VCC')
    assert.ok(board.schematic.drawing.labels.length > 0)
    assert.ok(board.schematic.drawing.labels.every(l => l.displayName === 'VCC' && l.net === board.schematic.nets[0].name))
    assert.match(board.schematic.nets[0].name, /^CH(?:1|200)\/VCC$/)
  }
  const geometry = board => board.schematic.drawing.symbols.map(s => ({ label: s.displayRef, at: s.at, box: s.box }))
  assert.deepEqual(geometry(views[0]), geometry(views[1]), 'schematic positions are independent of PCB instance placement')
})
