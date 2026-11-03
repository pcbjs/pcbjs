// Sourcing: MPN and MPN:<tag> keys by .source(), inline and out of line, the order of its calls, tag resolution per board or
// target, the BOM columns, the sourcing ERC rules and the site data fields.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, * as core from '@pcbjs/core'
import { h, nets, variants, resetDefaults, defineDefaultBoard, resolveSourcing, SchematicError, bindRef } from '@pcbjs/core'
import { R0603, C0603, PinHeader } from '@pcbjs/lib'
import { compileBoard, compileBoards, CompileError } from '@pcbjs/compile'
import { bomCsv, bomRows } from '@pcbjs/export/internal/bom'
import { buildFab } from '@pcbjs/export/internal/fab'
import { siteData } from '@pcbjs/export/internal/site-data'
import JLC2 from '@pcbjs/fab/JLCPCB/2-Layer'
import OSH2 from '@pcbjs/fab/OSHPark/2-Layer'
import PCBWay2 from '@pcbjs/fab/PCBWay/2-Layer'
import Euro2 from '@pcbjs/fab/Eurocircuits/2-Layer'
import APCB2 from '@pcbjs/fab/AdvancedPCB/2-Layer'
import { fresh } from './parts.mjs'

beforeEach(() => {
  resetDefaults()
  fresh()
})

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const board = (parts, props = {}, C = PCB) => h(C, { name: 'Src', ...props }, edge(), ...parts.map((p, i) => h(p, { at: `${5 + 6 * (i % 4)} ${5 + 6 * Math.floor(i / 4)}` })))
const two = () => {
  const { A, B } = nets()
  return [A, B]
}
const fieldsOf = (b, ref) => b.footprints.find(f => f.ref === ref).fields
const rule = (b, r) => b.erc.filter(d => d.rule === r)

test('sourcing: inline by .source(), keys and plain fields in one bag; a spec in the factory options is an error', () => {
  const [A, B] = two()
  const R1 = bindRef(R0603('101').source({ MPN: 'M-101', 'MPN:US': 'U-101' }).connect({ 1: A, 2: B }), 'R1')
  const R2 = bindRef(R0603('102').source({ MPN: 'old', tolerance: '1%' }).source({ MPN: 'M-102', 'MPN:LCSC': 'C102' }).connect({ 1: A, 2: B }), 'R2')
  const b = compileBoard(board([R1, R2]))
  assert.deepEqual(fieldsOf(b, 'R1'), { MPN: 'M-101', 'MPN:US': 'U-101' })
  assert.deepEqual(fieldsOf(b, 'R2'), { MPN: 'M-102', tolerance: '1%', 'MPN:LCSC': 'C102' })
  assert.throws(() => R0603('103').source({ MPN: {} }), SchematicError)
  assert.throws(() => R0603('103').source({ 'MPN:': 'x' }), /needs a tag/)
  assert.throws(() => R0603('103', { MPN: 'x' }), /unknown part option "MPN"/)
  assert.throws(() => R0603('103', { source: { MPN: 'x' } }), /unknown part option "source"/)
  assert.throws(() => R0603('103', { fields: { MPN: 'x' } }), /unknown part option "fields"/)
})

test('sourcing: .source() merges over the options, later calls win, and returns the same part', () => {
  const [A, B] = two()
  const R = bindRef(R0603('111').source({ MPN: 'M-111', 'MPN:US': 'U-111' }), 'R1')
  assert.equal(R.source({ 'MPN:US': 'U-override' }), R)
  R.source({ Manufacturer: 'Yageo' }).source({ Manufacturer: 'Panasonic' }).connect({ 1: A, 2: B })
  const b = compileBoard(board([R]))
  assert.deepEqual(fieldsOf(b, 'R1'), { MPN: 'M-111', 'MPN:US': 'U-override', Manufacturer: 'Panasonic' })
})

test('sourcing: out of line by .source() on each part, a loop for several; source() is gone', () => {
  const [A, B] = two()
  const R1 = bindRef(R0603('121').connect({ 1: A, 2: B }), 'R1'),
    R2 = bindRef(R0603('121').connect({ 1: A, 2: B }), 'R2'),
    R3 = bindRef(R0603('122').connect({ 1: A, 2: B }), 'R3')
  const C1 = bindRef(C0603('121').connect({ 1: A, 2: B }), 'C1'),
    C2 = bindRef(C0603('1u').connect({ 1: A, 2: B }), 'C2')
  const R121 = { MPN: 'R-121' }
  for (const r of [R1, R2]) r.source(R121)
  for (const c of [C1, C2]) c.source({ MPN: 'C-any' })
  C2.source({ 'MPN:US': 'C-us' })
  const b = compileBoard(board([R1, R2, R3, C1, C2]))
  assert.equal(fieldsOf(b, 'R1').MPN, 'R-121')
  assert.equal(fieldsOf(b, 'R2').MPN, 'R-121')
  assert.equal(fieldsOf(b, 'R3').MPN, undefined, 'another part')
  assert.deepEqual(fieldsOf(b, 'C1'), { MPN: 'C-any' })
  assert.deepEqual(fieldsOf(b, 'C2'), { MPN: 'C-any', 'MPN:US': 'C-us' })
  assert.equal(core.source, undefined)
})

test('sourcing: .source() calls merge key by key in call order, and a placement takes no fields', () => {
  const [A, B] = two()
  const R = bindRef(
    R0603('131')
      .source({ MPN: 'first', 'MPN:US': 'first', 'MPN:EU': 'first', 'MPN:CN': 'first', Datasheet: 'first' })
      .source({ 'MPN:US': 'second', 'MPN:EU': 'second', 'MPN:CN': 'second', Datasheet: 'second' })
      .source({ 'MPN:US': 'third', 'MPN:EU': 'third', 'MPN:CN': 'third' })
      .connect({ 1: A, 2: B }),
    'R1',
  )
  R.source({ 'MPN:EU': 'fourth', 'MPN:CN': 'fourth' }).source({ 'MPN:CN': 'last' })
  const b = compileBoard(h(PCB, { name: 'Src' }, edge(), h(R, { at: '5 5' })))
  assert.deepEqual(fieldsOf(b, 'R1'), { MPN: 'first', 'MPN:US': 'third', 'MPN:EU': 'fourth', 'MPN:CN': 'last', Datasheet: 'second' })
  assert.throws(() => compileBoard(h(PCB, { name: 'Src' }, edge(), h(R, { at: '5 5', fields: { 'MPN:CN': 'placement' } }))), /not fields/)
})

test('sourcing: the keys belong to the part, whatever modules the entry imports', () => {
  const [A, B] = two()
  const R = bindRef(R0603('141').source({ MPN: 'R-141' }).connect({ 1: A, 2: B }), 'R1')
  const here = new URL(import.meta.url).pathname
  assert.equal(fieldsOf(compileBoard(board([R]), { files: new Set([here]) }), 'R1').MPN, 'R-141')
  assert.equal(fieldsOf(compileBoard(board([R]), { files: new Set(['/elsewhere/board.tsx']) }), 'R1').MPN, 'R-141')
})

test('sourcing: resolution takes the first tag present, else MPN, else nothing; tags as written', () => {
  const f = { MPN: 'any', 'MPN:US': 'us', 'MPN:LCSC': 'lcsc', Manufacturer: 'Yageo', Datasheet: 'https://x' }
  assert.deepEqual(resolveSourcing(f, ['LCSC', 'US']), {
    mpn: 'lcsc',
    tag: 'LCSC',
    all: { MPN: 'any', 'MPN:US': 'us', 'MPN:LCSC': 'lcsc' },
    manufacturer: 'Yageo',
    datasheet: 'https://x',
  })
  assert.equal(resolveSourcing(f, ['DigiKey', 'US']).tag, 'US', 'the tag as the list spells it')
  assert.equal(resolveSourcing(f, ['DigiKey', 'US']).mpn, 'us')
  assert.deepEqual([resolveSourcing(f, ['EU']).mpn, resolveSourcing(f, ['EU']).tag], ['any', ''])
  assert.deepEqual([resolveSourcing(f, []).mpn, resolveSourcing(f, []).tag], ['any', ''])
  assert.deepEqual(resolveSourcing({ 'MPN:US': 'us' }, ['EU']), { mpn: null, tag: null, all: { 'MPN:US': 'us' } })
  assert.deepEqual(resolveSourcing({ tolerance: '1%' }, ['EU']), { mpn: null, tag: null, all: {} })
  // one case: a tag matches as written, and a key in another case is a plain field
  assert.equal(resolveSourcing({ 'MPN:us': 'us' }, ['US']).mpn, null)
  assert.deepEqual(resolveSourcing({ mpn: 'x', datasheet: 'https://x' }, []), { mpn: null, tag: null, all: {} })
})

test('sourcing: bom rows resolve with the board tags, bom.csv has the fixed columns, the rest, every tag and MPN:*', () => {
  const [A, B] = two()
  const R1 = bindRef(R0603('151').source({ MPN: 'R-151', 'MPN:LCSC': 'C151', Manufacturer: 'Yageo', tolerance: '1%' }).connect({ 1: A, 2: B }), 'R1')
  const R2 = bindRef(R0603('152').source({ 'MPN:US': 'U-152', Datasheet: 'https://d' }).connect({ 1: A, 2: B }), 'R2')
  const R3 = bindRef(R0603('153').connect({ 1: A, 2: B }), 'R3')
  const b = compileBoard(board([R1, R2, R3], { sourcing: ['LCSC', 'US'] }))
  assert.deepEqual(b.sourcingTags, ['LCSC', 'US'])
  const rows = bomRows(b)
  assert.deepEqual(
    rows.map(r => [r.sourcing.mpn, r.sourcing.tag]),
    [
      ['C151', 'LCSC'],
      ['U-152', 'US'],
      [null, null],
    ],
  )
  const csv = bomCsv(b).trimEnd().split('\n')
  assert.equal(csv[0], 'Refs,Value,Footprint,Qty,MPN,Source,Manufacturer,Datasheet,tolerance,MPN:LCSC,MPN:US,MPN:*')
  assert.equal(csv[1], 'R1,151,pcbjs:R_0603_1608Metric,1,C151,LCSC,Yageo,,1%,C151,,R-151')
  assert.equal(csv[2], 'R2,152,pcbjs:R_0603_1608Metric,1,U-152,US,,https://d,,,U-152,')
  assert.equal(csv[3], 'R3,153,pcbjs:R_0603_1608Metric,1,,,,,,,,')
  // without tags the catch-all is the MPN column, Source reads MPN, and there is no MPN:* column
  const P1 = bindRef(R0603('151').source({ MPN: 'R-151', 'MPN:LCSC': 'C151', Manufacturer: 'Yageo', tolerance: '1%' }).connect({ 1: A, 2: B }), 'R1')
  const plain = bomCsv(compileBoard(board([P1])))
    .trimEnd()
    .split('\n')
  assert.equal(plain[0], 'Refs,Value,Footprint,Qty,MPN,Source,Manufacturer,Datasheet,tolerance,MPN:LCSC')
  assert.equal(plain[1], 'R1,151,pcbjs:R_0603_1608Metric,1,R-151,MPN,Yageo,,1%,C151')
  const readme = buildFab(b).readme
  assert.match(readme, /^Sourcing: tags LCSC, US; 3 rows, 1 without a part number$/m)
})

test('sourcing: unsourced-part warns for a row without any MPN only with requireSourcing', () => {
  const [A, B] = two()
  const R1 = bindRef(R0603('161').source({ MPN: 'R-161' }).connect({ 1: A, 2: B }), 'R1'),
    R2 = bindRef(R0603('162').connect({ 1: A, 2: B }), 'R2')
  assert.equal(rule(compileBoard(board([R1, R2])), 'unsourced-part').length, 0)
  const b = compileBoard(board([R1, R2], { rules: { requireSourcing: true } }))
  const w = rule(b, 'unsourced-part')
  assert.equal(w.length, 1)
  assert.equal(w[0].severity, 'warning')
  assert.match(w[0].message, /^R2, 162,/)
  assert.deepEqual(w[0].at, b.footprints.find(f => f.ref === 'R2').at)
  assert.throws(() => compileBoard(board([R1], { rules: { requireSourcing: 'yes' } })), CompileError)
})

test('sourcing: unsourced-target warns when tags are set and only tagged MPNs that none matches are given', () => {
  const [A, B] = two()
  const R1 = bindRef(R0603('171').source({ 'MPN:US': 'U-171' }).connect({ 1: A, 2: B }), 'R1')
  const R2 = bindRef(R0603('172').source({ 'MPN:US': 'U-172', MPN: 'R-172' }).connect({ 1: A, 2: B }), 'R2')
  const R3 = bindRef(R0603('173').connect({ 1: A, 2: B }), 'R3')
  const b = compileBoard(board([R1, R2, R3], { sourcing: ['LCSC'] }))
  const w = rule(b, 'unsourced-target')
  assert.deepEqual(
    w.map(x => [x.severity, x.message.split(',')[0]]),
    [['warning', 'R1']],
  )
  assert.equal(rule(compileBoard(board([R1, R2, R3], { sourcing: ['US'] })), 'unsourced-target').length, 0)
  assert.equal(rule(compileBoard(board([R1, R2, R3])), 'unsourced-target').length, 0, 'no tags, no target to miss')
  assert.ok(b.erc.every(x => x.severity === 'warning'))
})

test('sourcing: preset tags, over the defaults and under the element', () => {
  assert.deepEqual(JLC2.preset.sourcing, ['LCSC', 'CN'])
  assert.deepEqual(PCBWay2.preset.sourcing, ['CN'])
  assert.deepEqual(OSH2.preset.sourcing, ['DigiKey', 'US'])
  assert.deepEqual(Euro2.preset.sourcing, ['Mouser', 'EU'])
  assert.deepEqual(APCB2.preset.sourcing, ['DigiKey', 'US'])
  const empty = (C, props) => compileBoard(h(C, { name: 'P', ...props }, edge()))
  assert.deepEqual(empty(PCB).sourcingTags, [])
  defineDefaultBoard({ sourcing: ['EU'] })
  assert.deepEqual(empty(PCB).sourcingTags, ['EU'])
  assert.deepEqual(empty(JLC2).sourcingTags, ['LCSC', 'CN'], 'the preset wins over the defaults')
  assert.deepEqual(empty(JLC2, { sourcing: ['US'] }).sourcingTags, ['US'], 'the element wins over the preset')
  assert.deepEqual(empty(PCB, { sourcing: [] }).sourcingTags, [])
  assert.throws(() => empty(PCB, { sourcing: 'US' }), /sourcing must be a list/)
  assert.throws(() => empty(PCB, { sourcing: ['MPN:US'] }), /sourcing must be a list/)
})

test('sourcing: variant targets carry their tags, the object form too', () => {
  const [A, B] = two()
  const R = bindRef(R0603('181').source({ MPN: 'R-181', 'MPN:LCSC': 'C181', 'MPN:US': 'U-181', 'MPN:EU': 'E-181' }).connect({ 1: A, 2: B }), 'R1')
  const V = variants(JLC2, OSH2, { name: 'House' }, { name: 'Euro', sourcing: ['EU'] })
  assert.deepEqual(
    V.targets.map(t => t.sourcing),
    [['LCSC', 'CN'], ['DigiKey', 'US'], undefined, ['EU']],
  )
  const boards = compileBoards(board([R], {}, V))
  assert.deepEqual(
    boards.map(b => b.sourcingTags),
    [['LCSC', 'CN'], ['DigiKey', 'US'], [], ['EU']],
  )
  assert.deepEqual(
    boards.map(b => bomRows(b)[0].sourcing.mpn),
    ['C181', 'U-181', 'R-181', 'E-181'],
  )
  const own = compileBoards(board([R], { sourcing: ['US'] }, V))
  assert.ok(
    own.every(b => b.sourcingTags.join() === 'US'),
    'the element wins over every target',
  )
})

test('sourcing: site data carries bom[].sourcing and sourcingTags', () => {
  const [A, B] = two()
  const R = bindRef(R0603('191').source({ MPN: 'R-191', 'MPN:LCSC': 'C191', Manufacturer: 'Yageo' }).connect({ 1: A, 2: B }), 'R1')
  const b = compileBoard(board([R], {}, JLC2))
  const site = siteData(b, { root: '/', fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', dev: false, bom: bomRows(b) })
  assert.deepEqual(site.sourcingTags, ['LCSC', 'CN'])
  assert.deepEqual(site.bom[0].sourcing, { mpn: 'C191', tag: 'LCSC', all: { MPN: 'R-191', 'MPN:LCSC': 'C191' }, manufacturer: 'Yageo' })
  assert.equal(site.footprints[0].fields['MPN:LCSC'], 'C191')
  assert.deepEqual(JSON.parse(JSON.stringify(site)).sourcingTags, ['LCSC', 'CN'])
})

test('sourcing: a header takes the same keys through .source()', () => {
  const J1 = bindRef(PinHeader(2)().source({ MPN: 'PEC02SAAN', 'MPN:US': 'S1011EC-02-ND' }), 'J1')
  const b = compileBoard(h(PCB, { name: 'Plain', sourcing: ['US'] }, edge(), h(J1, { at: '5 5' })))
  assert.deepEqual(bomRows(b)[0].sourcing, { mpn: 'S1011EC-02-ND', tag: 'US', all: { MPN: 'PEC02SAAN', 'MPN:US': 'S1011EC-02-ND' } })
})
