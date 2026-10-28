// Sourcing: MPN and MPN:<tag> keys inline and out of line, their precedence, tag resolution per board or target, the BOM
// columns, the sourcing ERC rules and the site data fields. Factory rules persist in the registry until this file calls
// source() again after a compile, so every test uses its own resistor value.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, source, variants, resetDefaults, defineDefaultBoard, resolveSourcing, SchematicError } from '@pcbjs/core'
import { R0603, C0603, PinHeader } from '@pcbjs/lib'
import { compileBoard, compileBoards, CompileError } from '@pcbjs/compile'
import { bomCsv, bomRows } from '@pcbjs/export/bom'
import { buildFab } from '@pcbjs/export/fab'
import { siteData } from '@pcbjs/export/site-data'
import JLC2 from '@pcbjs/fab/JLCPCB/2-Layer'
import OSH2 from '@pcbjs/fab/OSHPark/2-Layer'
import PCBWay2 from '@pcbjs/fab/PCBWay/2-Layer'
import Euro2 from '@pcbjs/fab/Eurocircuits/2-Layer'
import APCB2 from '@pcbjs/fab/AdvancedPCB/2-Layer'

beforeEach(() => resetDefaults())

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const board = (parts, props = {}, C = PCB) => h(C, { name: 'Src', ...props }, edge(), ...parts.map((p, i) => h(p, { at: `${5 + 6 * (i % 4)} ${5 + 6 * Math.floor(i / 4)}` })))
const two = () => {
  const { A, B } = nets()
  return [A, B]
}
const fieldsOf = (b, ref) => b.footprints.find(f => f.ref === ref).fields
const rule = (b, r) => b.erc.filter(d => d.rule === r)

test('sourcing: inline as the second argument or as options.source, over options.fields', () => {
  const [A, B] = two()
  const R1 = R0603('101', { MPN: 'M-101', 'MPN:US': 'U-101' }).connect(A, B)
  const R2 = R0603({ value: '102', fields: { MPN: 'old', tolerance: '1%' }, source: { MPN: 'M-102', 'MPN:LCSC': 'C102' } }).connect(A, B)
  const b = compileBoard(board([R1, R2]))
  assert.deepEqual(fieldsOf(b, 'R1'), { MPN: 'M-101', 'MPN:US': 'U-101' })
  assert.deepEqual(fieldsOf(b, 'R2'), { MPN: 'M-102', tolerance: '1%', 'MPN:LCSC': 'C102' })
  assert.throws(() => R0603('103', { MPN: {} }), SchematicError)
  assert.throws(() => R0603('103', { 'MPN:': 'x' }), /needs a tag/)
})

test('sourcing: .source() merges over the options, later calls win, and returns the same part', () => {
  const [A, B] = two()
  const R = R0603('111', { MPN: 'M-111', 'MPN:US': 'U-111' })
  assert.equal(R.source({ 'MPN:US': 'U-override' }), R)
  R.source({ Manufacturer: 'Yageo' }).source({ Manufacturer: 'Panasonic' }).connect(A, B)
  const b = compileBoard(board([R]))
  assert.deepEqual(fieldsOf(b, 'R1'), { MPN: 'M-111', 'MPN:US': 'U-override', Manufacturer: 'Panasonic' })
})

test('sourcing: out of line by part, by an array of parts and by factory and value', () => {
  const [A, B] = two()
  const R1 = R0603('121').connect(A, B),
    R2 = R0603('121').connect(A, B),
    R3 = R0603('122').connect(A, B)
  const C1 = C0603('121').connect(A, B),
    C2 = C0603('1u').connect(A, B)
  source(R0603, '121', { MPN: 'R-121' })
  source([C1, C2], { MPN: 'C-any' })
  source(C2, { 'MPN:US': 'C-us' })
  const b = compileBoard(board([R1, R2, R3, C1, C2]))
  assert.equal(fieldsOf(b, 'R1').MPN, 'R-121')
  assert.equal(fieldsOf(b, 'R2').MPN, 'R-121')
  assert.equal(fieldsOf(b, 'R3').MPN, undefined, 'another value')
  assert.deepEqual(fieldsOf(b, 'C1'), { MPN: 'C-any' }, 'the factory rule is for R0603 only')
  assert.deepEqual(fieldsOf(b, 'C2'), { MPN: 'C-any', 'MPN:US': 'C-us' })
  assert.throws(() => source(R0603, { MPN: 'x' }), SchematicError)
  assert.throws(() => source('R1', { MPN: 'x' }), SchematicError)
  assert.throws(() => source([R1, 'R2'], { MPN: 'x' }), /item 2 is not a part/)
})

test('sourcing: precedence is factory rule, part rule, options, .source(), placement fields', () => {
  const [A, B] = two()
  source(R0603, '131', { MPN: 'factory', 'MPN:US': 'factory', 'MPN:EU': 'factory', 'MPN:CN': 'factory', Datasheet: 'factory' })
  const R = R0603('131', { 'MPN:US': 'options', 'MPN:EU': 'options', 'MPN:CN': 'options' }).source({ 'MPN:EU': 'chain', 'MPN:CN': 'chain' }).connect(A, B)
  source(R, { 'MPN:US': 'part', 'MPN:EU': 'part', 'MPN:CN': 'part', Datasheet: 'part' })
  const b = compileBoard(h(PCB, { name: 'Src' }, edge(), h(R, { at: '5 5', fields: { 'MPN:CN': 'placement' } })))
  assert.deepEqual(fieldsOf(b, 'R1'), { MPN: 'factory', 'MPN:US': 'options', 'MPN:EU': 'chain', 'MPN:CN': 'placement', Datasheet: 'part' })
})

test('sourcing: compile option files limits factory rules to the modules the entry imports', () => {
  const [A, B] = two()
  source(R0603, '141', { MPN: 'R-141' })
  const R = R0603('141').connect(A, B)
  const here = new URL(import.meta.url).pathname
  assert.equal(fieldsOf(compileBoard(board([R]), { files: new Set([here]) }), 'R1').MPN, 'R-141')
  assert.equal(fieldsOf(compileBoard(board([R]), { files: new Set(['/elsewhere/board.tsx']) }), 'R1').MPN, undefined)
})

test('sourcing: resolution takes the first tag present, else MPN, else nothing; tags ignore case', () => {
  const f = { MPN: 'any', 'MPN:us': 'us', 'MPN:LCSC': 'lcsc', Manufacturer: 'Yageo', datasheet: 'https://x' }
  assert.deepEqual(resolveSourcing(f, ['LCSC', 'US']), {
    mpn: 'lcsc',
    tag: 'LCSC',
    all: { MPN: 'any', 'MPN:us': 'us', 'MPN:LCSC': 'lcsc' },
    manufacturer: 'Yageo',
    datasheet: 'https://x',
  })
  assert.equal(resolveSourcing(f, ['DigiKey', 'US']).tag, 'US', 'the tag as the list spells it')
  assert.equal(resolveSourcing(f, ['DigiKey', 'US']).mpn, 'us')
  assert.deepEqual([resolveSourcing(f, ['EU']).mpn, resolveSourcing(f, ['EU']).tag], ['any', ''])
  assert.deepEqual([resolveSourcing(f, []).mpn, resolveSourcing(f, []).tag], ['any', ''])
  assert.deepEqual(resolveSourcing({ 'MPN:US': 'us' }, ['EU']), { mpn: null, tag: null, all: { 'MPN:US': 'us' } })
  assert.deepEqual(resolveSourcing({ tolerance: '1%' }, ['EU']), { mpn: null, tag: null, all: {} })
})

test('sourcing: bom rows resolve with the board tags, bom.csv has the fixed columns, the rest, every tag and MPN:*', () => {
  const [A, B] = two()
  const R1 = R0603('151', { MPN: 'R-151', 'MPN:LCSC': 'C151', Manufacturer: 'Yageo', tolerance: '1%' }).connect(A, B)
  const R2 = R0603('152', { 'MPN:US': 'U-152', Datasheet: 'https://d' }).connect(A, B)
  const R3 = R0603('153').connect(A, B)
  const b = compileBoard(board([R1, R2, R3], { sourcing: ['lcsc', 'US'] }))
  assert.deepEqual(b.sourcingTags, ['lcsc', 'US'])
  const rows = bomRows(b)
  assert.deepEqual(
    rows.map(r => [r.sourcing.mpn, r.sourcing.tag]),
    [
      ['C151', 'lcsc'],
      ['U-152', 'US'],
      [null, null],
    ],
  )
  const csv = bomCsv(b).trimEnd().split('\n')
  assert.equal(csv[0], 'Refs,Value,Footprint,Qty,MPN,Source,Manufacturer,Datasheet,tolerance,MPN:LCSC,MPN:US,MPN:*')
  assert.equal(csv[1], 'R1,151,pcbjs:R_0603_1608Metric,1,C151,lcsc,Yageo,,1%,C151,,R-151')
  assert.equal(csv[2], 'R2,152,pcbjs:R_0603_1608Metric,1,U-152,US,,https://d,,,U-152,')
  assert.equal(csv[3], 'R3,153,pcbjs:R_0603_1608Metric,1,,,,,,,,')
  // without tags the catch-all is the MPN column, Source reads MPN, and there is no MPN:* column
  const plain = bomCsv(compileBoard(board([R1])))
    .trimEnd()
    .split('\n')
  assert.equal(plain[0], 'Refs,Value,Footprint,Qty,MPN,Source,Manufacturer,Datasheet,tolerance,MPN:LCSC')
  assert.equal(plain[1], 'R1,151,pcbjs:R_0603_1608Metric,1,R-151,MPN,Yageo,,1%,C151')
  const readme = buildFab(b).readme
  assert.match(readme, /^Sourcing: tags lcsc, US; 3 rows, 1 without a part number$/m)
})

test('sourcing: unsourced-part warns for a row without any MPN only with requireSourcing', () => {
  const [A, B] = two()
  const R1 = R0603('161', { MPN: 'R-161' }).connect(A, B),
    R2 = R0603('162').connect(A, B)
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
  const R1 = R0603('171', { 'MPN:US': 'U-171' }).connect(A, B)
  const R2 = R0603('172', { 'MPN:US': 'U-172', MPN: 'R-172' }).connect(A, B)
  const R3 = R0603('173').connect(A, B)
  const b = compileBoard(board([R1, R2, R3], { sourcing: ['LCSC'] }))
  const w = rule(b, 'unsourced-target')
  assert.deepEqual(
    w.map(x => [x.severity, x.message.split(',')[0]]),
    [['warning', 'R1']],
  )
  assert.equal(rule(compileBoard(board([R1, R2, R3], { sourcing: ['us'] })), 'unsourced-target').length, 0)
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
  const R = R0603('181', { MPN: 'R-181', 'MPN:LCSC': 'C181', 'MPN:US': 'U-181', 'MPN:EU': 'E-181' }).connect(A, B)
  const V = variants(JLC2, OSH2, { name: 'House' }, { name: 'Euro', sourcing: ['eu'] })
  assert.deepEqual(
    V.targets.map(t => t.sourcing),
    [['LCSC', 'CN'], ['DigiKey', 'US'], undefined, ['eu']],
  )
  const boards = compileBoards(board([R], {}, V))
  assert.deepEqual(
    boards.map(b => b.sourcingTags),
    [['LCSC', 'CN'], ['DigiKey', 'US'], [], ['eu']],
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
  const R = R0603('191', { MPN: 'R-191', 'MPN:LCSC': 'C191', Manufacturer: 'Yageo' }).connect(A, B)
  const b = compileBoard(board([R], {}, JLC2))
  const site = siteData(b, { root: '/', fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', dev: false, bom: bomRows(b) })
  assert.deepEqual(site.sourcingTags, ['LCSC', 'CN'])
  assert.deepEqual(site.bom[0].sourcing, { mpn: 'C191', tag: 'LCSC', all: { MPN: 'R-191', 'MPN:LCSC': 'C191' }, manufacturer: 'Yageo' })
  assert.equal(site.footprints[0].fields['MPN:LCSC'], 'C191')
  assert.deepEqual(JSON.parse(JSON.stringify(site)).sourcingTags, ['LCSC', 'CN'])
})

test('sourcing: plain footprints take the same keys through fields', () => {
  const b = compileBoard(
    h(PCB, { name: 'Plain', sourcing: ['US'] }, edge(), h(PinHeader, { ref: 'J1', pins: 2, at: '5 5', fields: { MPN: 'PEC02SAAN', 'MPN:US': 'S1011EC-02-ND' } })),
  )
  assert.deepEqual(bomRows(b)[0].sourcing, { mpn: 'S1011EC-02-ND', tag: 'US', all: { MPN: 'PEC02SAAN', 'MPN:US': 'S1011EC-02-ND' } })
})
