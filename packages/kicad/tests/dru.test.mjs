// The board importer's rule overrides: the custom rules of a .kicad_dru it maps onto part rules, class clearances and classes
// of net groups, those it leaves as comments, and the clearance and paste margin of a pad.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mapDru, parseCondition, padSpecs, importBoard, importBoardData, readKicadPcb, readKicadPro, readKicadDru } from '../dist/index.js'

const TABS = join(import.meta.dirname, 'fixtures', 'boards', 'tabs')
const tabs = () => [readKicadPcb(join(TABS, 'tabs.kicad_pcb')), readKicadPro(join(TABS, 'tabs.kicad_pro'))]

const refs = new Map([
  ['J1', 'J1'],
  ['J4', 'J4'],
  ['U3', 'U3'],
  ['T5', 'T5'],
])
const rule = (name, constraint, condition) => ({ name, constraints: [constraint], condition })
const map = (rules, opts = {}) =>
  mapDru(rules, refs, opts.classOf ?? new Map(), new Set(opts.classes ?? ['Default', 'power']), new Set(opts.nets ?? ['A', 'B', 'C']), n => n.replace(/\W/g, ''))

test('dru: conditions in disjunctive form', () => {
  assert.deepEqual(parseCondition("A.Type == 'Pad' && A.Parent == 'J1'"), [
    [
      { side: 'A', field: 'Type', value: 'Pad' },
      { side: 'A', field: 'Parent', value: 'J1' },
    ],
  ])
  assert.equal(parseCondition("(A.NetName == 'A' || A.NetName == 'B') && (B.NetName == 'A' || B.NetName == 'B')").length, 4)
  assert.equal(parseCondition("A.intersectsCourtyard('J1')"), null)
})

test('dru: a rule naming one footprint is a part override', () => {
  const m = map([
    rule('cut end', 'edge_clearance (min 0.26mm)', "A.Type == 'Pad' && A.Parent == 'J1'"),
    rule('fine pitch', 'clearance (min 0.15mm)', "A.Type == 'Pad' && B.Type == 'Pad' && A.Parent == 'U3' && B.Parent == 'U3'"),
    rule('usb', 'hole_clearance (min 0.17mm)', "(A.Parent == 'J1' && B.Parent == 'J1') || (A.Reference == 'J4' && B.Reference == 'J4')"),
    rule('neck', 'track_width (min 4mil)', "A.Reference == 'U3'"),
  ])
  assert.deepEqual(m.unmapped, [])
  assert.deepEqual(Object.fromEntries(m.parts), { J1: { edgeClearance: 0.26, holeClearance: 0.17 }, U3: { clearance: 0.15, trackWidth: 0.1016 }, J4: { holeClearance: 0.17 } })
})

test('dru: a class condition sets the class clearance, a symmetric net group becomes a class, the rest stays a comment', () => {
  const m = map([
    rule('pwr', 'clearance (min 0.3mm)', "A.NetClass == 'power' && B.NetClass == 'power'"),
    rule('Pi lines', 'clearance (min 0.18mm)', "(A.NetName == 'A' || A.NetName == 'B') && (B.NetName == 'A' || B.NetName == 'B')"),
    rule('tooling', 'courtyard_clearance (min -50mm)', "(A.Reference == 'J1' && B.Reference == 'T5')"),
    rule('two parts', 'clearance (min 0.1mm)', "A.Reference == 'J1' && B.Reference == 'T5'"),
    rule('half group', 'clearance (min 0.1mm)', "A.NetName == 'A' && B.NetName == 'B'"),
    rule('unknown class', 'clearance (min 0.1mm)', "A.NetClass == 'nope'"),
  ])
  assert.deepEqual([...m.classes], [['power', 0.3]])
  assert.deepEqual(m.netGroups, [{ name: 'Pilines', nets: ['A', 'B'], clearance: 0.18 }])
  assert.deepEqual(
    m.unmapped.map(r => r.name),
    ['tooling', 'two parts', 'half group', 'unknown class'],
  )
  // a group whose nets already have a class is left alone
  assert.equal(map([rule('g', 'clearance (min 0.18mm)', "A.NetName == 'A' && B.NetName == 'A'")], { classOf: new Map([['A', 'power']]) }).unmapped.length, 1)
})

test('dru: a pad keeps its own clearance and a negative paste margin; 0 means not set', () => {
  const pad = { num: '1', kind: 'smd', at: [0, 0], rot: 0, shape: 'rect', size: [1, 1], offset: [0, 0], layers: ['F.Cu', 'F.Paste', 'F.Mask'] }
  assert.equal(padSpecs({ ...pad, clearance: 0.15, pasteMargin: -0.05 })[0].props.clearance, 0.15)
  assert.equal(padSpecs({ ...pad, clearance: 0.15, pasteMargin: -0.05 })[0].props.pasteShrink, 0.05)
  assert.equal(padSpecs({ ...pad, clearance: 0 })[0].props.clearance, undefined)
})

test('dru: a board import writes the part rules, the class and the comments', () => {
  const [board, pro] = tabs()
  const r = importBoardData(board, pro, {
    dru: [
      rule('cut end', 'edge_clearance (min 0.26mm)', "A.Type == 'Pad' && A.Parent == 'J1'"),
      rule('pair', 'clearance (min 0.18mm)', "(A.NetName == 'SIG' || A.NetName == 'GND') && (B.NetName == 'SIG' || B.NetName == 'GND')"),
      rule('tooling', 'courtyard_clearance (min -50mm)', "A.Reference == 'J1' && B.Reference == 'J2'"),
    ],
  })
  assert.match(r.files.get('pcb.sch.ts'), /J1 = Tab_Slot_1x02_P3_00mm\('Tabs'\)\.connect\(\{[^}]*\}\)\.rules\(\{ edgeClearance: 0\.26 \}\)/)
  assert.match(r.files.get('pcb.sch.ts'), /SIG: \{ 'class': 'pair' \}/)
  assert.match(r.files.get('pcb.tsx'), /pair: \{ clearance: 0\.18 \}/)
  const cfg = r.files.get('pcb.config.ts')
  assert.match(cfg, /carried as overrides[^\n]*\n\/\/   cut end: edgeClearance 0\.26 on J1\n\/\/   pair: clearance 0\.18 of the new class pair, 2 nets/)
  assert.match(cfg, /not carried[^\n]*\n\/\/   tooling: courtyard_clearance/)
})

test('dru: clearances between kinds of item become kind scoped part, net and class overrides', () => {
  const kinds = new Map([
    ['J1', new Set(['thru_hole'])],
    ['J4', new Set(['thru_hole', 'smd'])],
    ['U3', new Set(['smd'])],
    ['T5', new Set(['np_thru_hole'])],
  ])
  const m = mapDru(
    [
      rule('tht_pad_to_track', 'clearance (min 0.4mm)', "A.Type == 'Pad' && A.Pad_Type == 'Through-hole' && (B.Type == 'Track' || B.Type == 'Via')"),
      rule(
        'tht_pad_to_power_track',
        'clearance (min 0.5mm)',
        "A.Type == 'Pad' && A.Pad_Type == 'Through-hole' && (B.Type == 'Track' || B.Type == 'Via') && (B.NetName == 'A' || B.NetName == 'B')",
      ),
      rule('power_track_to_track', 'clearance (min 0.4mm)', "A.Type == 'Track' && B.Type == 'Track' && (A.NetName == 'A' || A.NetName == 'B') && B.NetName != 'C'"),
      rule('pad_to_pour', 'clearance (min 0.4mm)', "A.Type == 'Pad' && B.Type == 'Zone'"),
      rule('power class', 'clearance (min 0.3mm)', "A.NetClass == 'power' && A.Type == 'Via' && B.Type == 'Pad'"),
      rule('fine', 'clearance (min 0.15mm)', "A.Type == 'Pad' && A.Parent == 'U3' && B.Type == 'Track'"),
    ],
    refs,
    new Map(),
    new Set(['Default', 'power']),
    new Set(['A', 'B', 'C']),
    n => n,
    kinds,
  )
  assert.deepEqual(
    m.unmapped.map(r => r.name),
    ['tht_pad_to_track'],
    'J4 mixes through-hole and SMD pads',
  )
  assert.deepEqual(Object.fromEntries(m.parts), {
    J1: { clearance: { zone: 0.4 } },
    J4: { clearance: { zone: 0.4 } },
    U3: { clearance: { zone: 0.4, track: 0.15 } },
    T5: { clearance: { zone: 0.4 } },
  })
  assert.deepEqual(Object.fromEntries(m.nets), { A: { pad: { tht: 0.5 }, track: 0.4 }, B: { pad: { tht: 0.5 }, track: 0.4 } })
  assert.deepEqual([...m.classes], [['power', { pad: 0.3 }]])
  const as = Object.fromEntries(m.mapped.map(x => [x.rule.name, x.as]))
  assert.match(as.power_track_to_track, /^clearance 0\.4 to tracks on A, also where B\.NetName != 'C' does not hold; clearance 0\.4 to tracks on B/)
  assert.equal(as.tht_pad_to_power_track, 'clearance 0.5 to through-hole pads on A; clearance 0.5 to through-hole pads on B')
  // a part of through-hole pads alone takes the pad type rule, merged with a plain clearance by kind
  const one = mapDru(
    [
      rule('tht', 'clearance (min 0.4mm)', "A.Type == 'Pad' && A.Pad_Type == 'Through-hole' && (B.Type == 'Track' || B.Type == 'Via')"),
      rule('plain', 'clearance (min 0.3mm)', "A.Type == 'Pad' && A.Parent == 'J1'"),
    ],
    refs,
    new Map(),
    new Set(),
    new Set(),
    n => n,
    new Map([['J1', new Set(['thru_hole'])]]),
  )
  assert.deepEqual(Object.fromEntries(one.parts), { J1: { clearance: { track: 0.4, via: 0.4, pad: 0.3, zone: 0.3, text: 0.3, self: 0.3 } } })
  assert.deepEqual(parseCondition("B.NetName != 'GND'"), [[{ side: 'B', field: 'NetName', value: 'GND', neg: true }]])
})

test("dru: a pad carries KiCad's spoke angle, 45 degrees by default on a round pad", () => {
  const pad = { num: '1', kind: 'thru_hole', at: [0, 0], rot: 0, shape: 'circle', size: [1.7, 1.7], drill: [1, 1], offset: [0, 0], layers: ['*.Cu', '*.Mask'] }
  assert.deepEqual(padSpecs(pad)[0].props.thermal, { angle: 45 })
  assert.equal(padSpecs({ ...pad, thermalAngle: 90 })[0].props.thermal, undefined)
  assert.equal(padSpecs({ ...pad, shape: 'rect' })[0].props.thermal, undefined)
  assert.deepEqual(padSpecs({ ...pad, shape: 'roundrect', thermalAngle: 45 })[0].props.thermal, { angle: 45 })
  assert.equal(padSpecs({ ...pad, zoneConnect: 2 })[0].props.thermal, 'solid')
})

test('dru: a board import writes kind scoped clearances on parts and nets', () => {
  const [board, pro] = tabs()
  const r = importBoardData(board, pro, {
    dru: [
      rule('pad_to_pour', 'clearance (min 0.4mm)', "A.Type == 'Pad' && B.Type == 'Zone'"),
      rule('sig', 'clearance (min 0.3mm)', "A.Type == 'Track' && A.NetName == 'SIG' && B.Type == 'Pad'"),
    ],
  })
  const sch = r.files.get('pcb.sch.ts')
  assert.match(sch, /J1 = Tab_Slot_1x02_P3_00mm\('Tabs'\)\.connect\(\{[^}]*\}\)\.rules\(\{ clearance: \{ zone: 0\.4 \} \}\)/)
  assert.match(sch, /\nSIG\.rules\(\{ clearance: \{ pad: 0\.3 \} \}\)\n/)
  assert.match(r.files.get('pcb.config.ts'), /pad_to_pour: clearance 0\.4 to zones on every part\n\/\/   sig: clearance 0\.3 to pads on SIG/)
})

test('dru: a Pad_Type on the other side scopes the clearance toward pads by type', () => {
  const kinds = new Map([
    ['J1', new Set(['thru_hole'])],
    ['U3', new Set(['smd'])],
  ])
  const m = mapDru(
    [
      rule('track to smd', 'clearance (min 0.25mm)', "A.Type == 'Track' && A.NetName == 'A' && B.Type == 'Pad' && B.Pad_Type == 'SMD'"),
      rule('pad to tht', 'clearance (min 0.6mm)', "A.Type == 'Pad' && A.Parent == 'U3' && B.Type == 'Pad' && B.Pad_Type == 'Through-hole'"),
      rule('class to tht', 'clearance (min 0.5mm)', "A.NetClass == 'power' && A.Type == 'Via' && B.Type == 'Pad' && B.Pad_Type == 'Through-hole'"),
      rule('npth', 'clearance (min 0.5mm)', "A.Type == 'Track' && A.NetName == 'B' && B.Type == 'Pad' && B.Pad_Type == 'NPTH, mechanical'"),
    ],
    refs,
    new Map(),
    new Set(['Default', 'power']),
    new Set(['A', 'B']),
    n => n,
    kinds,
  )
  assert.deepEqual(m.unmapped, [])
  assert.deepEqual(Object.fromEntries(m.nets), { A: { pad: { smd: 0.25 } }, B: { pad: 0.5 } })
  assert.deepEqual(Object.fromEntries(m.parts), { U3: { clearance: { pad: { tht: 0.6 } } } })
  assert.deepEqual([...m.classes], [['power', { pad: { tht: 0.5 } }]])
  const as = Object.fromEntries(m.mapped.map(x => [x.rule.name, x.as]))
  assert.equal(as['track to smd'], 'clearance 0.25 to SMD pads on A')
  assert.match(as.npth, /to pads on B, also where B\.Pad_Type == 'NPTH, mechanical' does not hold/, 'a non-plated hole has no scope and stays the stricter rule')
})

test('dru: a board import writes a pad type scoped clearance on a net and a class', () => {
  const [board, pro] = tabs()
  const r = importBoardData(board, pro, {
    dru: [rule('sig tht', 'clearance (min 0.5mm)', "A.Type == 'Track' && A.NetName == 'SIG' && B.Type == 'Pad' && B.Pad_Type == 'Through-hole'")],
  })
  assert.match(r.files.get('pcb.sch.ts'), /\nSIG\.rules\(\{ clearance: \{ pad: \{ tht: 0\.5 \} \} \}\)\n/)
  assert.match(r.files.get('pcb.config.ts'), /sig tht: clearance 0\.5 to through-hole pads on SIG/)
})

test('dru: a board import reads the .kicad_dru and .kicad_sch beside the board', () => {
  assert.deepEqual(
    readKicadDru(join(TABS, 'tabs.kicad_dru')).map(r => r.name),
    ['slot end', 'sig to pads', 'tooling'],
  )
  const r = importBoard(join(TABS, 'tabs.kicad_pcb'))
  const sch = r.files.get('pcb.sch.ts')
  assert.match(sch, /J1 = Tab_Slot_1x02_P3_00mm\('Tabs'\)\.connect\(\{ 1: SIG, 2: GND \}\)\.rules\(\{ edgeClearance: 0\.5 \}\)/)
  assert.match(sch, /\nSIG\.rules\(\{ clearance: \{ pad: 0\.25 \} \}\)\n/)
  assert.match(r.files.get('pcb.config.ts'), /not carried[^\n]*\n\/\/   tooling: courtyard_clearance \(min -1mm\)/)
  assert.match(r.files.get('pcb.sourcing.ts'), /source\(R1, \{ MPN: 'RC1206FR-0710KL', Manufacturer: 'Yageo', 'MPN:LCSC': 'C122563' \}\)/)
})
