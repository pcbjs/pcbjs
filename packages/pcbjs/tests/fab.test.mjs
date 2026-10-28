'use strict'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { h, defineDefaultRules, defineDefaultBoard, resetDefaults, isBoundPCB as isBoundRoot } from '@pcbjs/core'
import { bindPCB as bindRoot } from '@pcbjs/fab'
import { compileBoard } from '@pcbjs/compile'
import { FABS, bindPCB, isBoundPCB } from '@pcbjs/fab/index'
import { JLCPCB, OSHPARK, BASE, resolveRules, withMaskColor } from '@pcbjs/lib/rules'
import { JLCPCB_2L, JLCPCB_4L_7628, OSHPARK_2L } from '@pcbjs/lib/stackups'
import PCB2, * as jlc2 from '@pcbjs/fab/JLCPCB/2-Layer'
import PCB8 from '@pcbjs/fab/JLCPCB/8-Layer'

const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 10, h: 10 })
const board = (C, props = {}) => compileBoard(h(C, { name: 'F', ...props }, outline()))
const coppers = s => s.layers.filter(l => l.type === 'copper').map(l => l.name)

beforeEach(() => resetDefaults())

test('fab: every preset in FABS loads and default-exports a bound component', async () => {
  assert.equal(FABS.length, 13)
  for (const p of FABS) {
    const m = await import(`@pcbjs/fab/${p}`)
    assert.equal(typeof m.default, 'function', p)
    assert.ok(isBoundPCB(m.default), p)
    assert.ok(m.stackup && m.rules && m.colors, p)
    assert.equal(m.default.preset.name, m.name, p)
    assert.ok(Object.isFrozen(m.default.preset), p)
    const b = board(m.default)
    assert.equal(b.rules.clearance, m.rules.clearance, p)
  }
  assert.equal(bindRoot, bindPCB)
  assert.equal(isBoundRoot, isBoundPCB)
  assert.equal(
    isBoundPCB(() => null),
    false,
  )
})

test('fab: the preset spec reads back from the JLCPCB 2-Layer module', () => {
  assert.equal(PCB2.preset.name, 'JLCPCB 2-Layer')
  assert.equal(PCB2.preset.fab, 'JLCPCB')
  assert.equal(PCB2.preset.rules.clearance, JLCPCB.clearance)
  assert.equal(jlc2.rules.clearance, JLCPCB.clearance)
  assert.equal(jlc2.name, 'JLCPCB 2-Layer')
})

test('fab: JLCPCB 2-Layer compiles with JLCPCB rules and a black mask', () => {
  const b = board(PCB2, { color: 'black', revision: 'B' })
  assert.equal(b.revision, 'B')
  assert.equal(b.copper, 2)
  assert.deepEqual(b.rules, withMaskColor(resolveRules(JLCPCB), 'Black'))
  assert.equal(b.stackup.maskColor, 'Black')
  assert.ok(b.stackup.layers.filter(l => l.type === 'mask').every(l => l.color === undefined || l.color === 'Black'))
  assert.equal(b.stackup.finish, JLCPCB_2L.finish)
  assert.equal(board(PCB2).stackup.maskColor, 'Green')
  assert.equal(board(PCB2, { color: 'Matte-Black' }).stackup.maskColor, 'Matte-Black', 'not in the JLCPCB palette, passed through')
})

test('fab: a CSS colour passes through, silk and finish override', () => {
  const b = board(PCB2, { color: '#123456', silk: 'black', finish: 'ENIG' })
  assert.equal(b.stackup.maskColor, '#123456')
  assert.equal(b.stackup.silkColor, 'Black')
  assert.equal(b.stackup.finish, 'ENIG')
  assert.equal(JLCPCB_2L.finish, 'HASL', 'the preset stackup is not changed')
})

test('fab: element rules win over the preset, key by key', () => {
  const b = board(PCB2, { rules: { clearance: 0.3 } })
  assert.equal(b.rules.clearance, 0.3)
  assert.equal(b.rules.minTrackWidth, JLCPCB.minTrackWidth)
})

test('fab: global defaults sit below the preset', () => {
  defineDefaultRules({ clearance: 0.25, minTrackWidth: 0.3 })
  defineDefaultBoard({ copper: 4, revision: 'D' })
  const b = board(PCB2)
  assert.equal(b.rules.clearance, JLCPCB.clearance)
  assert.equal(b.rules.minTrackWidth, JLCPCB.minTrackWidth)
  assert.equal(b.copper, 2)
  assert.equal(b.revision, 'D', 'a default the preset leaves out still applies')
  assert.equal(board(PCB2, { rules: { clearance: 0.2 } }).rules.clearance, 0.2)
})

test('fab: an explicit stackup replaces the preset one, a disagreeing copper is an error', () => {
  const b = board(PCB2, { stackup: JLCPCB_4L_7628, color: 'red' })
  assert.equal(b.copper, 4)
  assert.equal(b.stackup.maskColor, 'Red')
  assert.throws(() => board(PCB2, { copper: 4 }), /copper=\{4\} disagrees with the stackup/)
})

test('fab: the 8-layer preset yields In1 to In6', () => {
  const b = board(PCB8)
  assert.equal(b.copper, 8)
  assert.deepEqual(coppers(b.stackup), ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu', 'B.Cu'])
})

test('fab: bindPCB makes a custom fab', () => {
  const Mine = bindPCB({ name: 'Mine 2-Layer', fab: 'Mine', stackup: OSHPARK_2L, rules: { ...BASE, clearance: 0.2 }, colors: { Purple: '#4b1f6f', Teal: '#0d5c5c' } })
  assert.equal(Mine.preset.name, 'Mine 2-Layer')
  const b = board(Mine, { color: 'teal' })
  assert.equal(b.stackup.maskColor, 'Teal')
  assert.equal(b.rules.clearance, 0.2)
  assert.equal(b.stackup.finish, 'ENIG')
  assert.notEqual(OSHPARK.clearance, 0.2)
})

test('fab: fabNotes from the defaults, the preset, a variant target and <PCB> print under Notes in that order, each once', async () => {
  const { buildFab } = await import('@pcbjs/export/fab')
  const { compileBoards } = await import('@pcbjs/compile')
  const { variants } = await import('@pcbjs/core')
  const DATE = '2026-01-01T00:00:00Z'
  const House = bindPCB({ name: 'House 2-Layer', fab: 'House', stackup: OSHPARK_2L, rules: BASE, fabNotes: ['Remove the order number.'] })
  defineDefaultBoard({ fabNotes: ['Ship in an ESD bag.'] })
  const b = board(House, { fabNotes: ['Single board, no panel.', 'Remove the order number.'] })
  assert.deepEqual(b.fabNotes, ['Ship in an ESD bag.', 'Remove the order number.', 'Single board, no panel.'])
  const notes = buildFab(b, DATE).readme.split('\nNotes\n')[1].split('\n')
  assert.deepEqual(notes.slice(0, 3), ['  Ship in an ESD bag.', '  Remove the order number.', '  Single board, no panel.'])
  resetDefaults()
  assert.equal(board(PCB2).fabNotes, undefined)
  assert.doesNotMatch(buildFab(board(PCB2), DATE).readme, /no panel/)
  const Multi = variants(House, { name: 'Shop', fabNotes: ['Panelize 2 x 2.'] })
  const [h1, h2] = compileBoards(h(Multi, { name: 'V', fabNotes: ['Single board, no panel.'] }, outline()))
  assert.deepEqual(h1.fabNotes, ['Remove the order number.', 'Single board, no panel.'])
  assert.deepEqual(h2.fabNotes, ['Panelize 2 x 2.', 'Single board, no panel.'])
  assert.throws(() => board(PCB2, { fabNotes: 'Single board' }), /fabNotes must be a list of lines/)
})

test('fab: README-fab names each font the text uses with its provenance', async () => {
  const { buildFab } = await import('@pcbjs/export/fab')
  const DATE = '2026-01-01T00:00:00Z'
  const text = (props, s) => h('text', { layer: 'F.SilkS', at: '5 5', size: 1, ...props }, s)
  const readme = kids => buildFab(compileBoard(h(PCB2, { name: 'T', silkRefs: false }, outline(), ...kids)), DATE).readme
  const hershey = readme([text({}, 'A')])
  assert.match(hershey, /Text is stroked in the Hershey Simplex font: 1 text item, line width 0\.15 mm\. The Hershey fonts were created by Dr\. A\. V\. Hershey/)
  assert.doesNotMatch(hershey, /NewStroke/)
  const ns = readme([text({ font: 'newstroke' }, 'B')])
  assert.match(ns, /Text is stroked in the NewStroke font: 1 text item, line width 0\.15 mm\. NewStroke is by Vladimir Uryvaev, made for KiCad, released under CC0 1\.0\./)
  assert.doesNotMatch(ns, /Hershey/)
  const both = readme([text({}, 'A'), text({ font: 'newstroke', at: '5 7' }, 'B')])
  assert.ok(both.indexOf('Hershey Simplex font') < both.indexOf('NewStroke font'))
  assert.match(readme([]), /  No text items\./)
})

test('fab: teardrops are regions of the copper Gerbers and pass the Gerber self check', async () => {
  const { buildFab } = await import('@pcbjs/export/fab')
  const { route } = await import('@pcbjs/core')
  const tht = (ref, x) => h('footprint', { ref, at: [x, 5], nets: { 1: 'A' } }, h('pad', { num: 1, size: 1.7, drill: 1, type: 'tht' }))
  const make = teardrops =>
    compileBoard(
      h(
        PCB2,
        { name: 'TD', silkRefs: false, teardrops },
        h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 10 }),
        tht('J1', 4),
        tht('J2', 16),
        route('J1.1', 'J2.1', 'Z').width(0.3),
      ),
      { routeCache: false },
    )
  const fab = buildFab(make({ pads: 'tht' }), '2026-01-01T00:00:00Z', { check: true })
  assert.match(fab.readme, /STATUS: ORDERABLE/)
  assert.match(fab.readme, /Gerber self check: passed/)
  const gtl = Object.entries(fab.files).find(([n]) => n.endsWith('.gtl'))[1]
  const plain = Object.entries(buildFab(make(false), '2026-01-01T00:00:00Z').files).find(([n]) => n.endsWith('.gtl'))[1]
  assert.equal((gtl.match(/^G36\*$/gm) ?? []).length - (plain.match(/^G36\*$/gm) ?? []).length, 2, 'one region per teardrop')
})

test('fab: the mask colour picks the JLCPCB mask web, maskWeb on the board overrides it, README-fab prints both', async () => {
  const { buildFab } = await import('@pcbjs/export/fab')
  const { compileBoards } = await import('@pcbjs/compile')
  const { variants } = await import('@pcbjs/core')
  assert.equal(board(PCB2).rules.maskWeb, 0.1)
  assert.equal(board(PCB2).rules.maskWebByColor, undefined, 'the table is resolved away')
  const black = board(PCB2, { color: 'black' })
  assert.equal(black.rules.maskWeb, 0.13)
  assert.match(buildFab(black, '2026-01-01T00:00:00Z').readme, /mask web\s+0\.13, black mask/)
  assert.equal(board(PCB2, { color: 'Red' }).rules.maskWeb, 0.1)
  assert.equal(board(PCB2, { color: 'white', rules: { maskWeb: 0.2 } }).rules.maskWeb, 0.2, 'maskWeb overrides the colour')
  const [g, w] = compileBoards(h(variants(PCB2, { name: 'White', color: 'White', rules: JLCPCB, board: { stackup: JLCPCB_2L } }), { name: 'V' }, outline()))
  assert.deepEqual([g.rules.maskWeb, w.rules.maskWeb], [0.1, 0.13])
  assert.throws(() => board(PCB2, { rules: { maskWebByColor: { Black: -1 } } }), /maskWebByColor must map mask colours to mm/)
})
