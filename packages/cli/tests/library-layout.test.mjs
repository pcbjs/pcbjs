import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { circuit, defineFootprint, h, layout, NC, resetDefaults } from '@pcbjs/core'
import { compileLayout } from '../dist/project/project.js'

test('library response contains only shared selected layout geometry and original source reference identities', async () => {
  resetDefaults()
  const Pad = defineFootprint(props => h('footprint', { ...props, bom: false }, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'TP' })
  const chan = circuit('channel', () => ({ R: Pad().connect({ 1: NC }) }))
  const CH1 = chan({}, 'CH1'), CH2 = chan({}, 'CH2')
  const Row = layout(chan, (g, { at, gap }) => h('g', { at }, h(g.R, { at: `${gap} 0` })), 'Row')
  const root = h(PCB, { name: 'B' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 80, h: 30 }), h(Row, { g: CH1, at: '10 10', gap: 3 }, h(CH1.R, { at: '20 0' })), h(Row, { g: CH2, at: '40 10', gap: 7 }))
  const loader = { load: async () => ({ default: root }), imported: () => new Set() }
  const { site: result } = await compileLayout(loader, { root: '/tmp' }, { file: '/tmp/pcb.tsx', rel: 'pcb.tsx' }, 'B', null, 'CH1')
  assert.equal(result.name, 'B')
  assert.equal(result.footprints.length, 1)
  assert.equal(result.footprints[0].displayRef, 'TP0')
  assert.equal(result.schematic.drawing.symbols.length, 1)
  assert.equal(result.schematic.drawing.symbols[0].ref, result.footprints[0].ref)
  assert.equal(result.schematic.drawing.symbols[0].displayRef, 'TP0')
  assert.equal(result.schematic.parts[0].displayRef, 'TP0', 'library labels survive site serialization')
  assert.ok(result.schematic.svg.markup.includes('data-ref=\"' + result.footprints[0].ref + '\"'))
  assert.deepEqual(result.schematic.circuits.map(c => c.path.join('/')), ['CH1'])
  assert.notEqual(result.footprints[0].ref, 'TP0', 'source identity is preserved')
  assert.equal(result.footprints[0].at[0], 13)
  assert.deepEqual(result.outline, [])
  assert.ok(result.items.every(it => it.ref === result.footprints[0].ref || it.path === 'CH1'))
  assert.equal(result.footprints[0].pads.length, 1, 'renumbered metadata and shape items agree')
  assert.ok(result.edit.every(n => n.ref === 'CH1' || n.ref.startsWith('CH1/') || n.ref === result.footprints[0].ref))
  assert.ok(!result.edit.some(n => n.owned), 'layout nodes expose shared source ownership')
  assert.ok(!result.layers.some(l => l.id === 'Edge.Cuts' && l.svg.trim()))
})

test('a named local group has a scoped library view without a layout component', async () => {
  resetDefaults()
  const Pad = defineFootprint(props => h('footprint', { ...props, bom: false }, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'TP' })
  const part = Pad({ ref: 'TP1' }).connect({ 1: NC })
  const root = h(PCB, { name: 'Groups' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 30 }), h('g', { name: 'Divider', at: '10 10' }, h(part, { at: '2 0' })))
  const loader = { load: async () => ({ default: root }), imported: () => new Set() }
  const { site, board } = await compileLayout(loader, { root: '/tmp' }, { file: '/tmp/pcb.tsx', rel: 'pcb.tsx' }, 'Groups', null, 'Divider')
  assert.equal(site.footprints.length, 1)
  assert.ok(site.schematic.circuits.some(c => c.kind === 'group' && c.path.join('/') === 'Divider'))
  assert.ok(board.edit.some(n => n.ref === 'Divider'))
  assert.deepEqual(site.outline, [])
})
