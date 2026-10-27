'use strict'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, defineDefaultBoard, defineDefaultRules, resetDefaults, BASE_BOARD, BASE_RULES, mergeRules } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { layerTable, copperLayers } from '@pcbjs/compile/layers'
import { buildFab } from '@pcbjs/export/fab'
import { twoLayer, fourLayer, sixLayer, eightLayer, JLCPCB_2L, JLCPCB_4L_7628, OSHPARK_2L, OSHPARK_4L } from '@pcbjs/lib/stackups'
import { BASE, JLCPCB, PCBWAY, OSHPARK, EUROCIRCUITS, ADVANCEDPCB, resolveRules, withMaskColor } from '@pcbjs/lib/rules'
import { near } from './helpers.mjs'

const DATE = '2026-01-01T00:00:00Z'
const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 10, h: 10 })
const board = (props = {}, ...kids) => compileBoard(h(PCB, { name: 'S', ...props }, outline(), ...kids))
const coppers = s => s.layers.filter(l => l.type === 'copper').map(l => l.name)
const sum = s => s.layers.reduce((t, l) => t + (['copper', 'core', 'prepreg', 'mask'].includes(l.type) ? l.thickness ?? 0 : 0), 0)

beforeEach(() => resetDefaults())

test('stackup: defaults are materialised for copper 2, 4 and 8', () => {
  for (const n of [2, 4, 8]) {
    const b = board(n === 2 ? {} : { copper: n })
    assert.equal(b.copper, n)
    assert.deepEqual(coppers(b.stackup), copperLayers(n))
    near(sum(b.stackup), 1.6, 1e-3, `${n} layers add up to ${sum(b.stackup)}`)
    assert.equal(b.thickness, 1.6)
  }
  const b4 = board({ copper: 4 })
  assert.deepEqual(b4.stackup.layers.filter(l => l.type === 'core' || l.type === 'prepreg').map(l => l.type), ['prepreg', 'core', 'prepreg'])
  assert.equal(b4.stackup.layers.find(l => l.name === 'F.Cu').weight, 1)
  assert.equal(b4.stackup.layers.find(l => l.name === 'In1.Cu').weight, 0.5)
})

test('stackup: copper with a thickness sizes the generated stackup', () => {
  const b = board({ copper: 4, thickness: 1.0 })
  assert.equal(b.thickness, 1.0)
  near(sum(b.stackup), 1.0, 1e-3)
})

test('stackup: a given stackup wins and sets the thickness', () => {
  const b = board({ stackup: JLCPCB_4L_7628 })
  assert.equal(b.copper, 4)
  assert.equal(b.thickness, 1.6)
  assert.equal(b.stackup.finish, 'HASL')
  assert.deepEqual(b.layers.filter(l => l.kind === 'copper').map(l => l.id), ['In2.Cu', 'In1.Cu', 'B.Cu', 'F.Cu'].sort((a, c) => b.layers.findIndex(l => l.id === a) - b.layers.findIndex(l => l.id === c)))
  // without a nominal thickness the layers are added up
  const s = { layers: [{ type: 'copper', name: 'F.Cu', thickness: 0.035 }, { type: 'core', thickness: 1.0 }, { type: 'copper', name: 'B.Cu', thickness: 0.035 }] }
  assert.equal(board({ stackup: s }).thickness, 1.07)
  // copper and stackup that agree are fine
  assert.equal(board({ copper: 4, stackup: fourLayer() }).copper, 4)
})

test('stackup: validation errors', () => {
  const cu = (name, t = 0.035) => ({ type: 'copper', name, thickness: t })
  const core = (t = 1.5) => ({ type: 'core', thickness: t })
  const bad = [
    [{ copper: 2, stackup: fourLayer() }, /copper=\{2\} disagrees with the stackup, which has 4/],
    [{ stackup: { layers: [cu('B.Cu'), core(), cu('F.Cu')] } }, /copper layer 1 is "B.Cu", expected F.Cu/],
    [{ stackup: { layers: [cu('F.Cu'), core(), cu('In2.Cu'), core(), cu('In1.Cu'), core(), cu('B.Cu')] } }, /expected In1.Cu/],
    [{ stackup: { layers: [cu('F.Cu'), cu('B.Cu')] } }, /no core or prepreg between F.Cu and B.Cu/],
    [{ stackup: { layers: [cu('F.Cu'), core(-1), cu('B.Cu')] } }, /positive thickness/],
    [{ stackup: { layers: [cu('F.Cu', 0), core(), cu('B.Cu')] } }, /positive thickness/],
    [{ stackup: { layers: [cu('F.Cu'), ...Array.from({ length: 9 }, (_, i) => [core(0.1), cu(`In${i + 1}.Cu`)]).flat(), core(0.1), cu('B.Cu')] } }, /at most 8/],
    [{ stackup: { layers: [cu('F.Cu'), core(), cu('In1.Cu'), core(), cu('B.Cu')] } }, /must be even/],
    [{ stackup: { layers: [cu('F.Cu')] } }, /needs F.Cu and B.Cu/],
    [{ stackup: { layers: [cu('F.Cu'), core(), cu('B.Cu'), { type: 'mask', side: 'F' }] } }, /above F.Cu/],
    [{ stackup: JLCPCB_4L_7628, thickness: 1.0 }, /thickness 1 mm disagrees with the stackup, which is 1.6 mm/],
    [{ stackup: { ...twoLayer(), thickness: 2.4 } }, /more than 10% off/],
    [{ copper: 3 }, /copper must be 2, 4, 6 or 8/],
    [{ rules: { clearence: 0.2 } }, /unknown rule "clearence"/],
  ]
  for (const [props, re] of bad) assert.throws(() => board(props), re, JSON.stringify(props).slice(0, 80))
})

test('stackup: layerTable for 8 layers has In1 to In6 with distinct colours', () => {
  const t = layerTable(8)
  const inner = t.filter(l => l.side === 'inner')
  assert.deepEqual(inner.map(l => l.id).sort(), ['In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu'])
  const colors = t.filter(l => l.kind === 'copper').map(l => l.color)
  assert.equal(new Set(colors).size, 8)
  assert.deepEqual(copperLayers(8), ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu', 'B.Cu'])
  assert.throws(() => layerTable(10), /2 to 8/)
})

test('stackup: builders are symmetric and add up to their thickness', () => {
  for (const [fn, n] of [[twoLayer, 2], [fourLayer, 4], [sixLayer, 6], [eightLayer, 8]]) {
    const s = fn()
    assert.equal(coppers(s).length, n)
    near(sum(s), 1.6, 1e-3)
    const t = s.layers.filter(l => l.thickness !== undefined).map(l => l.thickness)
    assert.deepEqual(t, [...t].reverse(), `${n} layers symmetric`)
  }
  const s = fourLayer({ thickness: 2.0, outerCopper: 2, finish: 'ENIG', maskColor: 'Black' })
  near(sum(s), 2.0, 1e-3)
  assert.equal(s.layers.find(l => l.name === 'F.Cu').thickness, 0.07)
  assert.equal(s.finish, 'ENIG')
  assert.equal(s.layers.find(l => l.type === 'mask').color, 'Black')
  for (const p of [JLCPCB_2L, JLCPCB_4L_7628, OSHPARK_2L, OSHPARK_4L]) assert.ok(board({ stackup: p }).copper >= 2)
})

test('job file: MaterialStackup of the JLC04161H-7628 preset', () => {
  const b = board({ stackup: JLCPCB_4L_7628 })
  const job = JSON.parse(buildFab(b, DATE).files['S-job.gbrjob'])
  assert.equal(job.GeneralSpecs.LayerNumber, 4)
  assert.equal(job.GeneralSpecs.BoardThickness, 1.6)
  assert.equal(job.GeneralSpecs.Finish, 'HAL SnPb')
  const seq = job.MaterialStackup.map(m => m.Type === 'Dielectric' ? `${m.Notes.split(':')[0]} ${m.Material} ${m.Thickness}` : m.Type === 'Copper' ? `${m.Name} ${m.Thickness}` : m.Name)
  assert.deepEqual(seq, [
    'Top Silk Screen', 'Top Solder Paste', 'Top Solder Mask',
    'F.Cu 0.035', 'Prepreg 7628 0.2104', 'In1.Cu 0.0152', 'Core FR4 1.065', 'In2.Cu 0.0152', 'Prepreg 7628 0.2104', 'B.Cu 0.035',
    'Bottom Solder Mask', 'Bottom Solder Paste', 'Bottom Silk Screen',
  ])
  assert.equal(job.MaterialStackup.find(m => m.Name === 'Top Solder Mask').Color, 'Green')
  const readme = buildFab(b, DATE).readme
  assert.match(readme, /^Stackup$/m)
  assert.match(readme, /core FR4 1.065 mm, er 4.6/)
  assert.match(readme, /finish HASL, green mask, white legend/)
  assert.match(readme, /^Rules \(mm\)$/m)
  assert.match(readme, /hole to hole\s+0.5$/m)
  const fab = buildFab(board({ copper: 6 }), DATE)
  for (const l of ['In1_Cu.g1', 'In4_Cu.g4']) assert.ok(fab.files[`S-${l}`], `${l} in the 6-layer fab set`)
  assert.equal(JSON.parse(fab.files['S-job.gbrjob']).GeneralSpecs.Finish, 'None')
})

test('rules: BASE is at least as strict as every fab preset', () => {
  const minimums = ['clearance', 'minTrackWidth', 'edgeClearance', 'holeClearance', 'minViaDrill', 'minViaDiameter', 'minAnnularRing', 'minPadAnnularRing', 'minDrill', 'minHoleToHole', 'silkMinWidth', 'silkMinHeight', 'silkToPad']
  for (const [name, set] of Object.entries({ JLCPCB, PCBWAY, OSHPARK, EUROCIRCUITS, ADVANCEDPCB })) {
    // maskWeb is optional: a set carries it only where its fab states one
    assert.deepEqual(Object.keys(set).filter(k => k !== 'maskWeb' && k !== 'maskWebByColor').sort(), Object.keys(BASE).sort(), `${name} is a full rule set`)
    const r = resolveRules(set)
    for (const k of minimums) assert.ok(BASE[k] >= r[k], `BASE.${k} ${BASE[k]} < ${name}.${k} ${r[k]}`)
  }
  assert.ok(BASE.minViaDiameter - BASE.minViaDrill >= 2 * BASE.minAnnularRing - 1e-9, 'the BASE via meets its own ring')
  assert.equal(BASE_RULES, BASE)
  assert.deepEqual(mergeRules(BASE, { clearance: 0.3 }, { minDrill: 0.4, clearance: undefined }), { ...BASE, clearance: 0.3, minDrill: 0.4 })
})

test('defaults: a full preset as rules, and a partial merged over BASE', () => {
  assert.deepEqual(board({ rules: JLCPCB }).rules, withMaskColor(resolveRules(JLCPCB), 'Green'))
  assert.deepEqual(board({ rules: { clearance: 0.2 } }).rules, { ...BASE, clearance: 0.2 })
  assert.deepEqual(board().rules, BASE)
})

test('defaults: apply when props omit a key, props win, resetDefaults clears', () => {
  defineDefaultBoard({ copper: 4, revision: 'A', thickness: 1.2 })
  let b = board()
  assert.equal(b.copper, 4)
  assert.equal(b.revision, 'A')
  assert.equal(b.thickness, 1.2)
  b = board({ copper: 2, revision: 'B' })
  assert.equal(b.copper, 2)
  assert.equal(b.revision, 'B')
  assert.equal(b.thickness, 1.2, 'thickness still from the default')
  // a default stackup gives way to copper in the props
  defineDefaultBoard({ stackup: JLCPCB_4L_7628 })
  assert.equal(board().copper, 4)
  assert.equal(board({ copper: 2 }).copper, 2)
  assert.throws(() => board({ thickness: 1.0 }), /disagrees with the stackup/)
  resetDefaults()
  b = board()
  assert.equal(b.copper, 2)
  assert.equal(b.revision, '')
  assert.deepEqual(b.rules, BASE)
})

test('defaults: each call replaces the earlier layer and returns the full frozen result', () => {
  const r1 = defineDefaultRules({ clearance: 0.3 })
  assert.deepEqual(r1, { ...BASE, clearance: 0.3 })
  const r2 = defineDefaultRules({ minDrill: 0.4 })
  assert.equal(r2.clearance, BASE.clearance, 'the earlier layer is replaced, not accumulated')
  const r3 = defineDefaultRules({ ...r1, minDrill: 0.4 })
  assert.equal(r3.clearance, 0.3)
  assert.equal(r3.minDrill, 0.4)
  // the rules default sits above the rules of the board default: a full set there would hide them, so pass a partial
  defineDefaultRules({ minDrill: 0.4 })
  const b = defineDefaultBoard({ copper: 4, rules: { edgeClearance: 0.5 } })
  assert.equal(b.copper, 4)
  assert.equal(b.stackup.layers.filter(l => l.type === 'copper').length, 4)
  assert.equal(b.rules.edgeClearance, 0.5)
  assert.equal(b.rules.minDrill, 0.4, 'the rules default merges over the board default rules')
  assert.throws(() => defineDefaultBoard({ name: 'X' }), /name and children/)
  assert.throws(() => defineDefaultBoard({ copper: 2, stackup: fourLayer() }), /disagrees/)
  assert.equal(board().copper, 4, 'a rejected call leaves the earlier default in place')
})

test('defaults: rules merge key by key through base, default and props', () => {
  defineDefaultBoard({ rules: { clearance: 0.3, minTrackWidth: 0.3 } })
  defineDefaultRules({ minTrackWidth: 0.25, edgeClearance: 0.5 })
  const r = board({ rules: { edgeClearance: 0.6 } }).rules
  assert.equal(r.clearance, 0.3, 'board default')
  assert.equal(r.minTrackWidth, 0.25, 'rules default over the board default')
  assert.equal(r.edgeClearance, 0.6, 'props over both')
  assert.equal(r.minDrill, BASE.minDrill, 'base')
})

test('defaults: the bases and returned values are frozen, mutation throws and does not reach the next compile', () => {
  assert.throws(() => { BASE_RULES.clearance = 9 }, TypeError)
  assert.throws(() => { BASE_BOARD.stackup.layers[3].thickness = 9 }, TypeError)
  assert.throws(() => { BASE_BOARD.stackup.layers.push({}) }, TypeError)
  assert.throws(() => { JLCPCB.clearance = 9 }, TypeError)
  assert.throws(() => { JLCPCB_4L_7628.layers[4].thickness = 9 }, TypeError)
  const r = defineDefaultRules({ clearance: 0.3 })
  assert.throws(() => { r.clearance = 9 }, TypeError)
  const b = defineDefaultBoard({ copper: 4 })
  assert.throws(() => { b.rules.clearance = 9 }, TypeError)
  assert.throws(() => { b.stackup.layers[3].thickness = 9 }, TypeError)
  // the input objects are copied: changing them after the call has no effect
  const partial = { clearance: 0.31 }
  defineDefaultRules(partial)
  partial.clearance = 9
  assert.equal(board().rules.clearance, 0.31)
  // a compiled board's rules and stackup are its own copies
  const c = board()
  c.rules.clearance = 9
  c.stackup.layers[3].thickness = 9
  assert.equal(board().rules.clearance, 0.31)
  assert.equal(board().stackup.layers[3].thickness, 0.035)
})
