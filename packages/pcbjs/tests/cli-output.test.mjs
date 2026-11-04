// The CLI's feedback: the findings formatter, the --json report, stale markers, inspect and the exit codes of check.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boardFindings,
  boardLine,
  diffFindings,
  diffLine,
  findingLine,
  findingPart,
  formatFindings,
  matchFinding,
  orderFindings,
  srcLine,
  timingsText,
} from '@pcbjs/export/internal/findings'
import { sealFindings } from '@pcbjs/compile/internal/seal'
import { markStale } from '@pcbjs/cli/internal/report'
import { errorText } from '@pcbjs/cli/internal/compile'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(PKG, 'bin', 'pcbjs.js')
const DEMO = resolve(PKG, '..', '..', 'examples', 'demo')

/** Run the CLI in `cwd`; resolves with the exit code and the output, never rejects. */
const cli = (cwd, ...args) =>
  new Promise(done => {
    execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NODE_ENV: 'production' }, timeout: 120000 }, (err, stdout, stderr) => {
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    })
  })

// ---- a synthetic board: R2 is CH2/R, two shorts between the same pads, a courtyard warning, an unplaced part ----
const SRC = { file: '/p/main.tsx', line: 30, col: 5 }
const fakeBoard = (drc, erc = []) => ({
  name: 'Fake',
  rev: 'A',
  items: [
    { id: 1, kind: 'pad', ref: 'R2', num: '2', net: 'A', at: [1, 1], layer: 'F.Cu', src: { file: '/p/node_modules/pcbjs/dist/lib/passives.js', line: 1, col: 1 } },
    { id: 2, kind: 'pad', ref: 'C1', num: '1', net: 'B', at: [2, 1], layer: 'F.Cu' },
    {
      id: 3,
      kind: 'track',
      net: 'A',
      layer: 'F.Cu',
      pts: [
        [0, 0],
        [1, 1],
      ],
      width: 0.2,
      src: { file: '/p/lib/row.tsx', line: 11, col: 53 },
    },
  ],
  footprints: [
    { ref: 'R2', src: SRC, pads: [1] },
    { ref: 'C1', src: { file: '/p/main.tsx', line: 35, col: 5 }, pads: [2] },
  ],
  schematic: {
    parts: [
      { ref: 'R2', path: ['CH2'], local: 'R', pins: [] },
      { ref: 'C1', path: [], local: 'C1', pins: [] },
      { ref: 'R9', path: ['CH9'], local: 'R', pins: [], src: { file: '/p/blinky.sch.ts', line: 7, col: 1 } },
    ],
    nets: [],
    circuits: [],
  },
  layers: [],
  nets: [],
  ratsnest: [],
  drc,
  erc,
  unconnected: 0,
  stats: { footprints: 2, pads: 2, tracks: 1, vias: 0, zones: 0, nets: 2 },
})
const short = { severity: 'error', rule: 'short', message: 'pad R2/2 (A) touches pad C1/1 (B) on F.Cu', at: [1.504, 1.0001], layer: 'F.Cu', items: [1, 2] }
const trackShort = { severity: 'error', rule: 'short', message: 'track A touches pad C1/1 (B) on F.Cu', at: [1.2, 1], layer: 'F.Cu', items: [3, 2] }
const court = { severity: 'warning', rule: 'courtyard', message: 'courtyards of R2 and C1 overlap', at: [1.5, 1], layer: 'F.CrtYd', items: [1, 2] }
const unplaced = { severity: 'error', rule: 'unplaced-part', message: 'R9, a resistor, is declared but never placed on the board', at: [0, 0], refs: ['R9'] }

/** The findings of a board as check reports them, once the compile has given each its refs, id and fingerprint. */
const reported = (b, root = '/p') => {
  sealFindings(b, b.variant?.name)
  return boardFindings(b, root)
}

test('findings: each line has severity, rule, layer, at, refs, the source, the message and the id', () => {
  const [f] = reported(fakeBoard([short]))
  assert.deepEqual(f.refs, ['R2/2', 'C1/1'])
  // a pad's own range is in the library: the placement of its part is the source
  assert.deepEqual(f.src, [{ file: 'main.tsx', start: [30, 5], end: [30, 5], role: 'part' }])
  assert.deepEqual(f.at, [1.5, 1])
  assert.equal(findingLine(f), 'error    short  F.Cu  at (1.50, 1.00)  R2/2, C1/1  main.tsx:30:5: pad R2/2 (A) touches pad C1/1 (B) on F.Cu')
  assert.match(f.id, /^drc:short:[0-9a-f]{12}$/)
  assert.match(f.fingerprint, /^[0-9a-f]{16}$/)
  assert.equal(f.board, 'Fake')
  // a track keeps its own range in the project
  assert.equal(srcLine(reported(fakeBoard([trackShort]))[0]), 'lib/row.tsx:11:53')
  // the marker's own range wins, such as the route call of a route-failed whose items are the blockers
  assert.equal(srcLine(reported(fakeBoard([{ ...short, rule: 'route-failed', src: { file: '/p/main.tsx', line: 48, col: 6 } }]))[0]), 'main.tsx:48:6')
  // an ERC finding without a position names its part by refs, with the part's declaration
  const [u] = reported(fakeBoard([], [unplaced]))
  assert.equal(u.at, null)
  assert.equal(findingLine(u), 'error    ERC unplaced-part  R9  blinky.sch.ts:7:1: R9, a resistor, is declared but never placed on the board')
})

test('findings: grouped by rule with a count, errors first, identical lines once with a count', () => {
  const lines = formatFindings([{ findings: reported(fakeBoard([court, short, short, trackShort])) }])
  assert.deepEqual(
    lines.map(l => l.trim().split('  ')[0]),
    ['DRC short: 3 errors', 'error', 'error', 'DRC courtyard: 1 warning', 'warning'],
  )
  assert.match(lines[1], /touches pad C1\/1 \(B\) on F\.Cu  x2  drc:short:[0-9a-f]{12}$/)
  assert.equal(lines.filter(l => l.includes('R2/2 (A) touches')).length, 1)
})

test('findings: each rule stops at the cap with the count of the rest', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ ...court, message: `courtyards of R2 and C${i} overlap`, at: [i, 0] }))
  const lines = formatFindings([{ findings: reported(fakeBoard([...many, short])) }], { cap: 40, more: 'all in r.json' })
  // the cap is per rule: the short after 50 courtyard warnings still shows, and first
  assert.equal(lines.length, 2 + 1 + 40 + 1)
  assert.equal(lines[0], '  DRC short: 1 error')
  assert.equal(lines.at(-1), '    and 10 more courtyard, all in r.json')
  assert.equal(formatFindings([{ findings: reported(fakeBoard(many)) }], { cap: 10 }).at(-1), '    and 40 more courtyard')
  assert.equal(formatFindings([{ findings: reported(fakeBoard(many)) }], { cap: 10, all: true }).length, 51)
})

// a route made inside a helper, route:3 of net A, whose leg failed and left the net unconnected
const helperRoute = {
  id: 'route:3',
  net: 'A',
  src: { file: '/p/lib/fan.tsx', line: 12, col: 5 },
  chain: [
    { file: '/p/main.tsx', line: 3, col: 1 },
    { file: '/p/main.tsx', line: 48, col: 6, call: true },
  ],
}
const failed = {
  severity: 'error',
  rule: 'route-failed',
  message: 'cannot route net A from (0, 0) on F.Cu to (1, 1) on F.Cu',
  at: [0.5, 0.5],
  layer: 'F.Cu',
  items: [2],
  src: helperRoute.src,
  refs: ['route:3', 'net:A'],
  witness: {
    layer: 'F.Cu',
    segments: [
      [
        [0, 0],
        [1, 1],
      ],
    ],
  },
}
const gap = x => ({ severity: 'error', rule: 'unconnected', message: 'net A is not fully connected', at: [x, 0], refs: ['net:A'] })
const edge = x => ({ severity: 'error', rule: 'edge-clearance', message: `pad R2/${x} is closer than 0.3 mm to the board edge on F.Cu`, at: [x, 0], layer: 'F.Cu', items: [1] })

test('findings: route-failed first, unconnected last and folded onto the failed route, handles and the helper call site', () => {
  const b = { ...fakeBoard([gap(1), gap(2), short, failed]), routes: [helperRoute] }
  const fs = reported(b)
  const rf = fs.find(f => f.rule === 'route-failed')
  assert.equal(rf.route, 'route:3')
  assert.ok(rf.refs.includes('net:A'))
  assert.deepEqual(
    rf.src.map(s => s.role),
    ['call', 'item'],
  )
  assert.equal(srcLine(rf), 'main.tsx:48:6 via lib/fan.tsx:12:5')
  assert.match(findingLine(rf), /  route:3, net:A, C1\/1  main\.tsx:48:6 via lib\/fan\.tsx:12:5: cannot route/)
  assert.deepEqual(fs.find(f => f.rule === 'unconnected').refs, ['net:A'])
  assert.deepEqual(
    orderFindings(fs).map(f => f.rule),
    ['route-failed', 'short', 'unconnected', 'unconnected'],
  )
  const lines = formatFindings([{ findings: fs }])
  assert.deepEqual(
    lines.filter(l => !l.startsWith('    ')),
    ['  DRC route-failed: 1 error', '  DRC short: 1 error', '  DRC unconnected: 2 errors'],
  )
  assert.equal(lines.at(-1), '    error    unconnected  A: net A is not fully connected in 2 places: route route:3 failed, see route-failed')
  assert.equal(formatFindings([{ findings: fs }], { all: true }).filter(l => l.includes('unconnected  at')).length, 2)
})

test('findings: a track made inside a helper shorting a pad names the helper call site via the route call, not via the pad placement', () => {
  const b = fakeBoard([{ ...trackShort, items: [2, 3] }])
  b.items[2] = { ...b.items[2], route: 'route:3', src: helperRoute.src, chain: helperRoute.chain }
  const [f] = reported({ ...b, routes: [helperRoute] })
  assert.equal(f.route, 'route:3')
  assert.equal(srcLine(f), 'main.tsx:48:6 via lib/fan.tsx:12:5')
})

test('findings: three or more findings of one rule on one footprint fold into one line', () => {
  const fs = reported(fakeBoard([edge(1), edge(2), edge(3), edge(4)]))
  assert.equal(findingPart(fs[0]), 'R2')
  const lines = formatFindings([{ findings: fs }])
  assert.deepEqual(lines, [
    '  DRC edge-clearance: 4 errors',
    '    error    edge-clearance  R2  main.tsx:30:5: 4 findings on R2, the first at (1.00, 0.00) on F.Cu: pad R2/1 is closer than 0.3 mm to the board edge on F.Cu',
  ])
  assert.equal(formatFindings([{ findings: fs.slice(0, 2) }]).length, 3)
  assert.equal(formatFindings([{ findings: fs }], { all: true }).length, 5)
})

test('findings: targets that share a finding print it once; one only some targets have names them', () => {
  const lines = formatFindings([
    { target: 'JLCPCB', findings: reported(fakeBoard([short])) },
    { target: 'OSH Park', findings: reported(fakeBoard([short, court])) },
    { target: 'House', findings: reported(fakeBoard([short])) },
  ])
  assert.equal(lines.filter(l => l.includes('touches')).length, 1)
  assert.doesNotMatch(
    lines.find(l => l.includes('touches')),
    /\[/,
  )
  assert.match(
    lines.find(l => l.includes('courtyards')),
    /  \[OSH Park\]  drc:courtyard:[0-9a-f]{12}$/,
  )
})

test('findings: ids hash board, target, rule, layer, uids and the position to 0.01 mm; fingerprints leave the position out', () => {
  const a = reported(fakeBoard([short, court, unplaced]))
  const b = reported(fakeBoard([{ ...short, at: [1.5011, 0.9999] }, court, unplaced]))
  assert.deepEqual(
    a.map(f => f.id),
    b.map(f => f.id),
  )
  assert.equal(new Set(a.map(f => f.id)).size, 3)
  const moved = reported(fakeBoard([{ ...short, at: [3, 3] }]))[0]
  assert.notEqual(moved.id, a[0].id)
  assert.equal(moved.fingerprint, a[0].fingerprint)
  const other = reported({ ...fakeBoard([short]), variant: { name: 'House', index: 0, names: ['House'] } })[0]
  assert.notEqual(other.id, a[0].id)
  assert.notEqual(other.fingerprint, a[0].fingerprint)
  // two findings that hash alike are told apart
  const twins = reported(fakeBoard([], [unplaced, { ...unplaced, message: 'R9 is declared twice' }]))
  assert.equal(new Set(twins.map(f => f.id)).size, 2)
})

test('findings: the diff matches by fingerprint, then by the nearest position, and counts new, fixed and unchanged', () => {
  const before = reported(fakeBoard([short, court]))
  const now = reported(fakeBoard([{ ...court, at: [1.7, 1] }, trackShort]))
  const d = diffFindings(before, now)
  assert.equal(diffLine(d), '1 new, 1 fixed, 1 unchanged')
  assert.equal(d.added[0].message, trackShort.message)
  const two = reported(fakeBoard([edge(1), edge(5)]))
  const moved = reported(fakeBoard([edge(5.1), edge(1.1)]))
  assert.equal(matchFinding(two[0], moved).at[0], 1.1)
  assert.equal(matchFinding(two[1], moved).at[0], 5.1)
})

test('summary line: counts, FAIL and the phase timings', () => {
  const b = { ...fakeBoard([short]), timings: { route: 120.4, zones: 80, connectivity: 50, drc: 90 } }
  assert.equal(
    boardLine(b, 'main.tsx', 2100),
    'Fake A  main.tsx  2 footprints, 2 pads, 1 track, 0 vias, 0 zones, 2 nets  DRC 1 error, 0 warnings, 0 unconnected  ERC ok  FAIL  2.1 s: route 120 ms, zones 80 ms, connectivity 50 ms, drc 90 ms',
  )
  assert.equal(timingsText(undefined), '')
  assert.equal(timingsText([{ name: 'route', ms: 1500 }]), 'route 1.5 s')
  assert.equal(timingsText({ route: 0.2, drc: 3 }), 'drc 3 ms')
})

test('errors: the one-line message first with the project location, the stack only when verbose', () => {
  const e = new Error('boom is not defined\nmore')
  e.stack = 'Error: boom\n    at f (/p/node_modules/x.js:1:1)\n    at /p/main.tsx:26:13\n    at g (file:///p/lib/a.ts:3:4)'
  assert.deepEqual(errorText(e, false, '/p'), { line: 'main.tsx:26:13: boom is not defined', detail: [] })
  const v = errorText(e, true, '/p')
  assert.equal(v.detail[0], 'more')
  assert.match(v.detail.at(-1), /lib\/a\.ts:3:4/)
})

test('stale: a failed entry marks its board JSON and fab directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-stale-'))
  try {
    const outDir = join(root, '.pcbjs', 'dist'),
      fabDir = join(root, '.pcbjs', 'fab')
    mkdirSync(join(outDir, 'boards', 'Multi'), { recursive: true })
    for (const d of [join(fabDir, 'Blinky'), join(outDir, 'fab', 'Blinky'), join(fabDir, 'Multi', 'house')]) mkdirSync(d, { recursive: true })
    writeFileSync(
      join(outDir, 'boards.json'),
      JSON.stringify({
        boards: [
          { name: 'Blinky', file: 'boards/Blinky.json', entry: 'main.tsx' },
          { name: 'Multi', variant: 'House', file: 'boards/Multi/house.json', entry: 'multi.tsx' },
        ],
      }),
    )
    writeFileSync(join(outDir, 'boards', 'Blinky.json'), JSON.stringify({ name: 'Blinky', drc: [] }))
    writeFileSync(join(outDir, 'boards', 'Multi', 'house.json'), JSON.stringify({ name: 'Multi' }))
    const marked = markStale({ root, outDir, fabDir }, 'main.tsx', 'main.tsx:3:1: boom')
    assert.deepEqual(marked.map(p => p.replaceAll('\\', '/')).sort(), ['.pcbjs/dist/boards/Blinky.json', '.pcbjs/dist/fab/Blinky/STALE', '.pcbjs/fab/Blinky/STALE'])
    const data = JSON.parse(readFileSync(join(outDir, 'boards', 'Blinky.json'), 'utf8'))
    assert.equal(data.stale, true)
    assert.equal(data.staleError, 'main.tsx:3:1: boom')
    assert.match(readFileSync(join(fabDir, 'Blinky', 'STALE'), 'utf8'), /^STALE: the last compile of main\.tsx failed/)
    // the other entry's outputs are untouched
    assert.equal(JSON.parse(readFileSync(join(outDir, 'boards', 'Multi', 'house.json'), 'utf8')).stale, undefined)
    assert.ok(!existsSync(join(fabDir, 'Multi', 'house', 'STALE')))
    assert.deepEqual(
      markStale({ root, outDir, fabDir }, 'multi.tsx', 'x').map(p => p.replaceAll('\\', '/')),
      ['.pcbjs/dist/boards/Multi/house.json', '.pcbjs/fab/Multi/house/STALE'],
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('inspect: the demo Blinky frame, Q1 with its pads, one pad, a net and an unknown name', async () => {
  const q1 = await cli(DEMO, 'inspect', 'blinky.pcb.tsx', 'Q1')
  assert.equal(q1.code, 0, q1.stderr)
  const lines = q1.stdout.trim().split('\n')
  assert.match(lines[0], /^Blinky 0\.1\.0  blinky\.pcb\.tsx  mm, x right, y down, rotation counter-clockwise on screen$/)
  assert.match(lines[1], /^outline  x 0\.00 to 30\.00, y 0\.00 to 20\.00, 30\.00 x 20\.00  copper F\.Cu B\.Cu$/)
  assert.match(lines[2], /^Q1  \S+  \S+  at \(26\.00, 10\.00\)  rot 0  side F  model generated  blinky\.pcb\.tsx:\d+:\d+$/)
  assert.match(lines[3], /^  pad\s+name\s+net\s+centre\s+size\s+layers\s+uid$/)
  assert.equal(lines.length, 7)
  assert.match(q1.stdout, /^  3\s+\S+\s+SW\s+\(27\.00, 10\.00\)/m)
  const pad = await cli(DEMO, 'inspect', 'blinky.pcb.tsx', 'Q1/3', '--json')
  const j = JSON.parse(pad.stdout)
  assert.deepEqual([j.pad.num, j.pad.net, j.pad.at], ['3', 'SW', [27, 10]])
  assert.deepEqual(j.frame.copper, ['F.Cu', 'B.Cu'])
  const path = await cli(DEMO, 'inspect', 'blinky.pcb.tsx', 'CH2/R')
  assert.match(path.stdout, /^R2 \(CH2\/R\)  /m)
  const gnd = await cli(DEMO, 'inspect', 'blinky.pcb.tsx', 'GND')
  assert.match(gnd.stdout, /^net GND  3 pads, 1 via, \d+ tracks?, 1 zone on B\.Cu  copper F\.Cu \d+\.\d mm², B\.Cu \d+\.\d mm²$/m)
  const all = await cli(DEMO, 'inspect', 'blinky.pcb.tsx')
  assert.match(all.stdout, /^  R2\s+CH2\/R\s+330\s+\(12\.00, 10\.00\)/m)
  const none = await cli(DEMO, 'inspect', 'blinky.pcb.tsx', 'NOPE')
  assert.equal(none.code, 1)
  assert.match(none.stdout, /^NOPE: no part, group or instance named NOPE$/m)
})

// ---- check against a throwaway project: a clean board, a board with a short, a module that throws ----
// the test pads of the throwaway boards, parts of modules of their own so a board file keeps its line numbers
const TESTPAD = `import { defineFootprint, type FootprintProps } from '@pcbjs/core'
export const TestPad = defineFootprint(function TestPad(props: FootprintProps) {
  return <footprint id="pcbjs:TestPad-2mm" bom={false} {...props}><pad num={1} size={2} shape="circle" /></footprint>
}, { pins: ['1'], prefix: 'TP' })
`
const pads = (...nets) => `import { nets } from '@pcbjs/core'
import { TestPad } from './testpad'
export const { V, W } = nets()
${nets.map((n, i) => `export const TP${i + 1} = TestPad('${n}').connect({ 1: ${n} })`).join('\n')}
`
const board = (name, second, mod = 'tp2') => `import PCB, { route } from '@pcbjs/core'; import { V, TP1, TP2${mod === 'tpw' ? ', TP3' : ''} } from './${mod}'
export default (
  <PCB name="${name}" rev="1.0" rules={{ clearance: 0.2, minTrackWidth: 0.2 }}>
    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />
    <TP1 at="5mm 10mm" />
    <TP2 at="15mm 10mm" />
    {route('5 10').net(V).width(0.5).H(15)}
    ${second}
  </PCB>
)
`
let root
before(() => {
  root = mkdtempSync(join(tmpdir(), 'pcbjs-check-'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(resolve(PKG, '..', '..', 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'testpad.tsx'), TESTPAD)
  writeFileSync(join(root, 'tp2.tsx'), pads('V', 'V'))
  writeFileSync(join(root, 'tp3.tsx'), pads('V', 'V', 'V'))
  writeFileSync(join(root, 'tpw.tsx'), pads('V', 'V', 'W'))
  writeFileSync(join(root, 'clean.tsx'), board('Clean', ''))
  writeFileSync(join(root, 'short.tsx'), board('Short', '<TP3 at="10mm 10.5mm" />', 'tpw'))
  writeFileSync(join(root, 'throws.tsx'), 'import PCB from \'@pcbjs/core\'\nconst x = undefinedThing\nexport default <PCB name="T" />\n')
  writeFileSync(join(root, 'fn.tsx'), 'import PCB from \'@pcbjs/core\'\nexport default () => <PCB name="T" />\n')
  // two routes made by one helper, called from lines 9 and 10
  writeFileSync(
    join(root, 'helper.tsx'),
    [
      "import PCB, { route } from '@pcbjs/core'; import { V, TP1, TP2, TP3 } from './tp3'",
      "const tie = (y: number) => route('5 10', `8 ${y}`).net(V).width(0.3).Z()",
      'export default (',
      '  <PCB name="Helper" rev="1.0">',
      '    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />',
      '    <TP1 at="5mm 10mm" />',
      '    <TP2 at="8mm 10mm" />',
      '    <TP3 at="8mm 14mm" />',
      '    {tie(10)}',
      '    {tie(14)}',
      '  </PCB>',
      ')',
    ].join('\n') + '\n',
  )
})

test('inspect: a route made inside a helper names the call site, then the route call; --lengths filters; a net lists its track widths', async () => {
  const r = await cli(root, 'inspect', 'helper.tsx', '--lengths')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^  route:1 +V .* helper\.tsx:9:6 via helper\.tsx:2:28$/m)
  assert.match(r.stdout, /^  route:2 +V .* helper\.tsx:10:6 via helper\.tsx:2:28$/m)
  const f = await cli(root, 'inspect', 'helper.tsx', '--lengths', 'NOPE')
  assert.match(f.stdout, /^no route of the net, pair or group NOPE$/m)
  const n = await cli(root, 'inspect', 'helper.tsx', 'V')
  assert.match(n.stdout, /^  track +uid +layer +width +length +from +to +route$/m)
  assert.match(n.stdout, /^  #\d+ +item:[0-9a-f]{12} +F\.Cu +0\.3 +3\.00 +\(5\.00, 10\.00\) +\(8\.00, 10\.00\) +route:1$/m)
  const j = JSON.parse((await cli(root, 'inspect', 'helper.tsx', 'V', '--json')).stdout)
  assert.deepEqual(j.tracks.find(t => t.route === 'route:2').pts, [
    [5, 10],
    [8, 14],
  ])
})
test("inspect: a route made in a .map callback inside a helper names the helper's call site; an inline .map route names none", async () => {
  writeFileSync(
    join(root, 'maps.tsx'),
    [
      "import PCB, { route } from '@pcbjs/core'; import { V, TP1, TP2, TP3 } from './tp3'",
      'function ties(y: number) {',
      "  return [0].map(() => route('5 10', `8 ${y}`).net(V).width(0.3).Z())",
      '}',
      'export default (',
      '  <PCB name="Maps" rev="1.0">',
      '    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />',
      '    <TP1 at="5mm 10mm" />',
      '    <TP2 at="8mm 10mm" />',
      '    <TP3 at="8mm 14mm" />',
      '    {[10, 14].map(ties)}',
      '    {[10].map(y => [',
      "      route('5 10', `8 ${y}`).net(V).width(0.25).Z(),",
      '    ])}',
      '  </PCB>',
      ')',
    ].join('\n') + '\n',
  )
  const r = await cli(root, 'inspect', 'maps.tsx', '--lengths')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^  route:1 +V .* maps\.tsx:11:15 via maps\.tsx:3:24$/m)
  assert.match(r.stdout, /^  route:2 +V .* maps\.tsx:11:15 via maps\.tsx:3:24$/m)
  assert.match(r.stdout, /^  route:3 +V .* maps\.tsx:13:7$/m)
})
after(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

test('check: exit 0 when clean, without fab files or a site', async () => {
  const r = await cli(root, 'check', 'clean.tsx')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^Clean 1\.0  clean\.tsx  2 footprints, .*  DRC ok  ERC ok  \d+(?:\.\d+)? (?:ms|s)/m)
  assert.match(r.stdout.trim().split('\n').at(-1), /^ok\s+DRC 0 errors/)
  assert.ok(!existsSync(join(root, '.pcbjs', 'fab')))
  assert.ok(!existsSync(join(root, '.pcbjs', 'dist')))
  assert.doesNotMatch(r.stdout + r.stderr, /vite|transforming|kB/)
})

/** The JSON type of a value as the schema fixture names it. */
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)
const SCHEMA = JSON.parse(readFileSync(join(PKG, 'tests', 'check-report.schema.json'), 'utf8'))
function fits(v, shape, what) {
  for (const [k, t] of Object.entries(SCHEMA[shape])) assert.equal(typeOf(v[k]), t, `${what}.${k}`)
}

test('check: exit 1 on DRC errors, every finding listed with its id, --json a pcbjs.check/1 report with the same ids on every run', async () => {
  const r = await cli(root, 'check', 'clean.tsx', 'short.tsx', '--json', 'out/report.json')
  assert.equal(r.code, 1)
  assert.match(r.stdout, /^Short 1\.0  short\.tsx  .*FAIL/m)
  assert.match(r.stdout, /^  DRC short: \d+ errors?$/m)
  assert.match(r.stdout, /^    error    short  F\.Cu  at \(\d+\.\d\d, \d+\.\d\d\)  TP3\/1, net:V  route:1  short\.tsx:\d+:\d+: .*  drc:short:[0-9a-f]{12}$/m)
  assert.match(r.stdout, /^    warning  single-pad  at \(10\.00, 10\.50\)  net:W, TP3\/1  short\.tsx:\d+:\d+: net W has only one pad  drc:single-pad:[0-9a-f]{12}$/m)
  assert.match(r.stdout, /^json   out[\\/]report\.json$/m)
  const one = JSON.parse(readFileSync(join(root, 'out', 'report.json'), 'utf8'))
  fits(one, 'report', 'report')
  assert.equal(one.schema, 'pcbjs.check/1')
  assert.deepEqual([one.command, one.result, one.exit], ['check', 'fail', 1])
  assert.deepEqual(
    one.boards.map(b => [b.name, b.status]),
    [
      ['Clean', 'ok'],
      ['Short', 'fail'],
    ],
  )
  const s = one.boards[1]
  fits(s, 'board', 'board')
  fits(s.stages[0], 'stage', 'stage')
  fits(s.findings[0], 'finding', 'finding')
  fits(s.findings[0].src[0], 'source', 'source')
  fits(one.typecheck, 'typecheck', 'typecheck')
  fits(one.cache, 'cache', 'cache')
  assert.equal(one.typecheck.status, 'skipped')
  for (const f of s.findings) assert.match(f.id, new RegExp(`^${f.kind}:${f.rule}:[0-9a-f]{12}$`))
  await cli(root, 'check', 'short.tsx', '--json', 'out/again.json')
  const two = JSON.parse(readFileSync(join(root, 'out', 'again.json'), 'utf8'))
  assert.deepEqual(
    two.boards[0].findings.map(f => [f.id, f.fingerprint]),
    s.findings.map(f => [f.id, f.fingerprint]),
  )
  assert.equal(two.boards[0].snapshot, s.snapshot)
  // a compile error is a diagnostic, never a finding, and makes the result an error
  await cli(root, 'check', 'throws.tsx', 'clean.tsx', '--json', 'out/error.json')
  const bad = JSON.parse(readFileSync(join(root, 'out', 'error.json'), 'utf8'))
  assert.deepEqual([bad.result, bad.exit, bad.boards.length], ['error', 1, 1])
  fits(bad.diagnostics[0], 'diagnostic', 'diagnostic')
  assert.deepEqual([bad.diagnostics[0].kind, bad.diagnostics[0].entry], ['compile', 'throws.tsx'])
})

test('check: exit 1 on a compile error, the one-line message with its location and no stack', async () => {
  const r = await cli(root, 'check', 'throws.tsx', 'clean.tsx')
  assert.equal(r.code, 1)
  const lines = r.stdout.trim().split('\n')
  assert.equal(lines[0], 'throws.tsx  compile error: throws.tsx:2:11: undefinedThing is not defined')
  assert.doesNotMatch(r.stdout + r.stderr, /^\s+at /m)
  // the other entry still compiles
  assert.match(r.stdout, /^Clean 1\.0  clean\.tsx/m)
  assert.match(lines.at(-1), /1 entry failed to compile$/)
  const v = await cli(root, 'check', 'throws.tsx', '--verbose')
  const vl = v.stdout.trim().split('\n')
  assert.match(vl[0], /compile error: throws\.tsx:2:11: undefinedThing is not defined$/)
  assert.match(vl[1], /^\s+at /)
})

test('check: an entry default-exports the element, never a function returning it', async () => {
  const r = await cli(root, 'check', 'fn.tsx')
  assert.equal(r.code, 1)
  assert.match(r.stdout, /fn\.tsx default-exports a function; export the element, export default <PCB …>, with top-level await for async setup/)
})

test('docs --grep: plain words are a substring, anything else a regular expression', async () => {
  const r = await cli(root, 'docs', '--grep', 'single-pad|route-failed')
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /single-pad/)
  assert.match(r.stdout, /route-failed/)
  // a pattern that does not parse falls back to a substring
  assert.equal((await cli(root, 'docs', '--grep', 'route(')).code, 0)
})
