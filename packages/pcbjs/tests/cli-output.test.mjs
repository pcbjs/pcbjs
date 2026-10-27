// The CLI's feedback: the findings formatter, the --json report, stale markers, inspect and the exit codes of check.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boardFindings, boardLine, diffFindings, diffLine, findingId, findingLine, formatFindings, orderFindings, timingsText } from '@pcbjs/export/findings'
import { markStale, errorText } from '@pcbjs/cli/check'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(PKG, 'bin', 'pcbjs.js')
const DEMO = resolve(PKG, '..', '..', 'examples', 'demo')

/** Run the CLI in `cwd`; resolves with the exit code and the output, never rejects. */
const cli = (cwd, ...args) => new Promise(done => {
  execFile(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NODE_ENV: 'production' }, timeout: 120000 }, (err, stdout, stderr) => {
    done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
  })
})

// ---- a synthetic board: R2 is CH2/R, two shorts between the same pads, a courtyard warning, an unplaced part ----
const SRC = { file: '/p/main.tsx', line: 30, col: 5 }
const fakeBoard = (drc, erc = []) => ({
  name: 'Fake', revision: 'A', items: [
    { id: 1, kind: 'pad', ref: 'R2', num: '2', net: 'A', at: [1, 1], layer: 'F.Cu', src: { file: '/p/node_modules/pcbjs/dist/lib/passives.js', line: 1, col: 1 } },
    { id: 2, kind: 'pad', ref: 'C1', num: '1', net: 'B', at: [2, 1], layer: 'F.Cu' },
    { id: 3, kind: 'track', net: 'A', layer: 'F.Cu', pts: [[0, 0], [1, 1]], width: 0.2, src: { file: '/p/lib/row.tsx', line: 11, col: 53 } },
  ],
  footprints: [{ ref: 'R2', src: SRC, pads: [1] }, { ref: 'C1', src: { file: '/p/main.tsx', line: 35, col: 5 }, pads: [2] }],
  schematic: { parts: [{ ref: 'R2', path: ['CH2'], local: 'R', pins: [] }, { ref: 'C1', path: [], local: 'C1', pins: [] }, { ref: 'R9', path: ['CH9'], local: 'R', pins: [], src: { file: '/p/blinky.sch.ts', line: 7, col: 1 } }], nets: [], circuits: [] },
  ratsnest: [], drc, erc, unconnected: 0, stats: { footprints: 2, pads: 2, tracks: 1, vias: 0, zones: 0, nets: 2 },
})
const short = { severity: 'error', rule: 'short', message: 'pad R2.2 (A) touches pad C1.1 (B) on F.Cu', at: [1.504, 1.0001], layer: 'F.Cu', items: [1, 2] }
const trackShort = { severity: 'error', rule: 'short', message: 'track A touches pad C1.1 (B) on F.Cu', at: [1.2, 1], layer: 'F.Cu', items: [3, 2] }
const court = { severity: 'warning', rule: 'courtyard', message: 'courtyards of R2 and C1 overlap', at: [1.5, 1], layer: 'F.CrtYd', items: [1, 2] }
const unplaced = { severity: 'error', rule: 'unplaced-part', message: 'R9, a resistor, is declared but never placed on the board', at: [0, 0] }

test('findings: each line has severity, rule, layer, at, refs with instance paths, the source and the message', () => {
  const [f] = boardFindings(fakeBoard([short]), '/p')
  assert.deepEqual(f.refs, [{ ref: 'R2', path: 'CH2/R' }, { ref: 'C1' }])
  // a pad's own range is in the library: the placement of its part is the source
  assert.equal(f.src, 'main.tsx:30:5')
  assert.deepEqual(f.at, [1.5, 1])
  assert.equal(findingLine(f), 'error    short  F.Cu  at (1.50, 1.00)  R2 (CH2/R), C1  main.tsx:30:5: pad R2.2 (A) touches pad C1.1 (B) on F.Cu')
  // a track keeps its own range in the project
  assert.equal(boardFindings(fakeBoard([trackShort]), '/p')[0].src, 'lib/row.tsx:11:53')
  // the marker's own range wins, such as the route call of a route-failed whose items are the blockers
  assert.equal(boardFindings(fakeBoard([{ ...short, rule: 'route-failed', src: { file: '/p/main.tsx', line: 48, col: 6 } }]), '/p')[0].src, 'main.tsx:48:6')
  // an ERC finding without a position names the part from its message, with the part's declaration
  const [u] = boardFindings(fakeBoard([], [unplaced]), '/p')
  assert.equal(u.at, null)
  assert.equal(findingLine(u), 'error    ERC unplaced-part  R9 (CH9/R)  blinky.sch.ts:7:1: R9, a resistor, is declared but never placed on the board')
})

test('findings: grouped by rule with a count, errors first, identical lines once with a count', () => {
  const lines = formatFindings([{ findings: boardFindings(fakeBoard([court, short, short, trackShort]), '/p') }])
  assert.deepEqual(lines.map(l => l.trim().split('  ')[0]), ['DRC short: 3 errors', 'error', 'error', 'DRC courtyard: 1 warning', 'warning'])
  assert.match(lines[1], /touches pad C1\.1 \(B\) on F\.Cu  x2$/)
  assert.equal(lines.filter(l => l.includes('R2.2 (A) touches')).length, 1)
})

test('findings: each rule stops at the cap with the count of the rest', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ ...court, message: `courtyards of R2 and C${i} overlap`, at: [i, 0] }))
  const lines = formatFindings([{ findings: boardFindings(fakeBoard([...many, short]), '/p') }], { cap: 40, more: 'all in r.json' })
  // the cap is per rule: the short after 50 courtyard warnings still shows, and first
  assert.equal(lines.length, 2 + 1 + 40 + 1)
  assert.equal(lines[0], '  DRC short: 1 error')
  assert.equal(lines.at(-1), '    and 10 more courtyard, all in r.json')
  assert.equal(formatFindings([{ findings: boardFindings(fakeBoard(many), '/p') }], { cap: 10 }).at(-1), '    and 40 more courtyard')
  assert.equal(formatFindings([{ findings: boardFindings(fakeBoard(many), '/p') }], { cap: 10, all: true }).length, 51)
})

// a route made inside a helper, route:3 of net A, whose leg failed and left the net unconnected
const helperRoute = { id: 'route:3', net: 'A', src: { file: '/p/lib/fan.tsx', line: 12, col: 5 }, chain: [{ file: '/p/main.tsx', line: 3, col: 1 }, { file: '/p/main.tsx', line: 48, col: 6, call: true }] }
const failed = { severity: 'error', rule: 'route-failed', message: 'cannot route net A from (0, 0) on F.Cu to (1, 1) on F.Cu', at: [0.5, 0.5], layer: 'F.Cu', items: [2], src: helperRoute.src, route: { net: 'A', leg: 1, legs: 1, from: { x: 0, y: 0, layer: 'F.Cu' }, to: { x: 1, y: 1, layer: 'F.Cu' }, layers: ['F.Cu'] } }
const gap = (x) => ({ severity: 'error', rule: 'unconnected', message: 'net A is not fully connected', at: [x, 0], net: 'A' })
const edge = (x) => ({ severity: 'error', rule: 'edge-clearance', message: `pad R2.${x} is closer than 0.3 mm to the board edge on F.Cu`, at: [x, 0], layer: 'F.Cu', items: [1] })

test('findings: route-failed first, unconnected last and folded onto the failed route, handles and the helper call site', () => {
  const b = { ...fakeBoard([gap(1), gap(2), short, failed]), routes: [helperRoute] }
  const fs = boardFindings(b, '/p')
  const rf = fs.find(f => f.rule === 'route-failed')
  assert.equal(rf.route, 'route:3')
  assert.equal(rf.net, 'A')
  assert.equal(rf.src, 'main.tsx:48:6')
  assert.equal(rf.via, 'lib/fan.tsx:12:5')
  assert.match(findingLine(rf), /  route:3  main\.tsx:48:6 via lib\/fan\.tsx:12:5: cannot route/)
  assert.equal(fs.find(f => f.rule === 'unconnected').net, 'A')
  assert.deepEqual(orderFindings(fs).map(f => f.rule), ['route-failed', 'short', 'unconnected', 'unconnected'])
  const lines = formatFindings([{ findings: fs }])
  assert.deepEqual(lines.filter(l => !l.startsWith('    ')), ['  DRC route-failed: 1 error', '  DRC short: 1 error', '  DRC unconnected: 2 errors'])
  assert.equal(lines.at(-1), '    error    unconnected  A: net A is not fully connected in 2 places: route route:3 failed, see route-failed')
  assert.equal(formatFindings([{ findings: fs }], { all: true }).filter(l => l.includes('unconnected  at')).length, 2)
})

test('findings: a track made inside a helper shorting a pad names the helper call site via the route call, not via the pad placement', () => {
  const b = fakeBoard([{ ...trackShort, items: [2, 3] }])
  b.items[2] = { ...b.items[2], route: 'route:3', src: helperRoute.src, chain: helperRoute.chain }
  const [f] = boardFindings({ ...b, routes: [helperRoute] }, '/p')
  assert.equal(f.route, 'route:3')
  assert.equal(f.src, 'main.tsx:48:6')
  assert.equal(f.via, 'lib/fan.tsx:12:5')
})

test('findings: three or more findings of one rule on one footprint fold into one line', () => {
  const fs = boardFindings(fakeBoard([edge(1), edge(2), edge(3), edge(4)]), '/p')
  assert.equal(fs[0].part, 'R2')
  const lines = formatFindings([{ findings: fs }])
  assert.deepEqual(lines, ['  DRC edge-clearance: 4 errors', '    error    edge-clearance  R2 (CH2/R)  main.tsx:30:5: 4 findings on R2, the first at (1.00, 0.00) on F.Cu: pad R2.1 is closer than 0.3 mm to the board edge on F.Cu'])
  assert.equal(formatFindings([{ findings: fs.slice(0, 2) }]).length, 3)
  assert.equal(formatFindings([{ findings: fs }], { all: true }).length, 5)
})

test('findings: targets that share a finding print it once; one only some targets have names them', () => {
  const b = fakeBoard([short])
  const lines = formatFindings([
    { target: 'JLCPCB', findings: boardFindings(b, '/p') },
    { target: 'OSH Park', findings: boardFindings(fakeBoard([short, court]), '/p') },
    { target: 'House', findings: boardFindings(b, '/p') },
  ])
  assert.equal(lines.filter(l => l.includes('touches')).length, 1)
  assert.doesNotMatch(lines.find(l => l.includes('touches')), /\[/)
  assert.match(lines.find(l => l.includes('courtyards')), /  \[OSH Park\]$/)
})

test('findings: ids hash the rule, the items and the position to 0.01 mm, and stay put across runs', () => {
  const a = boardFindings(fakeBoard([short, court, unplaced]), '/p').map(f => f.id)
  const b = boardFindings(fakeBoard([{ ...short, at: [1.5011, 0.9999] }, court, unplaced]), '/p').map(f => f.id)
  assert.deepEqual(a, b)
  assert.equal(new Set(a).size, 3)
  assert.match(a[0], /^[0-9a-f]{12}$/)
  assert.notEqual(findingId('drc', short), findingId('drc', { ...short, at: [3, 3] }))
  // without items the message tells two findings at the same place apart
  assert.notEqual(findingId('erc', unplaced), findingId('erc', { ...unplaced, message: 'R8 is declared' }))
})

test('findings: the diff counts new, fixed and unchanged', () => {
  const before = boardFindings(fakeBoard([short, court]), '/p')
  const now = boardFindings(fakeBoard([court, trackShort]), '/p')
  const d = diffFindings(before, now)
  assert.equal(diffLine(d), '1 new, 1 fixed, 1 unchanged')
  assert.equal(d.added[0].message, trackShort.message)
})

test('summary line: counts, FAIL and the phase timings', () => {
  const b = { ...fakeBoard([short]), timings: { route: 120.4, zones: 80, connectivity: 50, drc: 90 } }
  assert.equal(boardLine(b, 'main.tsx', 2100), 'Fake A  main.tsx  2 footprints, 2 pads, 1 track, 0 vias, 0 zones, 2 nets  DRC 1 error, 0 warnings, 0 unconnected  ERC ok  FAIL  2.1 s: route 120 ms, zones 80 ms, connectivity 50 ms, drc 90 ms')
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
    const outDir = join(root, '.pcbjs', 'dist'), fabDir = join(root, '.pcbjs', 'fab')
    mkdirSync(join(outDir, 'boards', 'Multi'), { recursive: true })
    for (const d of [join(fabDir, 'Blinky'), join(outDir, 'fab', 'Blinky'), join(fabDir, 'Multi', 'house')]) mkdirSync(d, { recursive: true })
    writeFileSync(join(outDir, 'boards.json'), JSON.stringify({ boards: [
      { name: 'Blinky', file: 'boards/Blinky.json', entry: 'main.tsx' },
      { name: 'Multi', variant: 'House', file: 'boards/Multi/house.json', entry: 'multi.tsx' },
    ] }))
    writeFileSync(join(outDir, 'boards', 'Blinky.json'), JSON.stringify({ name: 'Blinky', drc: [] }))
    writeFileSync(join(outDir, 'boards', 'Multi', 'house.json'), JSON.stringify({ name: 'Multi' }))
    const marked = markStale({ root, outDir, fabDir }, 'main.tsx', 'main.tsx:3:1: boom')
    assert.deepEqual(marked.sort(), ['.pcbjs/dist/boards/Blinky.json', '.pcbjs/dist/fab/Blinky/STALE', '.pcbjs/fab/Blinky/STALE'])
    const data = JSON.parse(readFileSync(join(outDir, 'boards', 'Blinky.json'), 'utf8'))
    assert.equal(data.stale, true)
    assert.equal(data.staleError, 'main.tsx:3:1: boom')
    assert.match(readFileSync(join(fabDir, 'Blinky', 'STALE'), 'utf8'), /^STALE: the last compile of main\.tsx failed/)
    // the other entry's outputs are untouched
    assert.equal(JSON.parse(readFileSync(join(outDir, 'boards', 'Multi', 'house.json'), 'utf8')).stale, undefined)
    assert.ok(!existsSync(join(fabDir, 'Multi', 'house', 'STALE')))
    assert.deepEqual(markStale({ root, outDir, fabDir }, 'multi.tsx', 'x'), ['.pcbjs/dist/boards/Multi/house.json', '.pcbjs/fab/Multi/house/STALE'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('inspect: the demo Blinky frame, Q1 with its pads, one pad, a net and an unknown name', async () => {
  const q1 = await cli(DEMO, 'inspect', 'blinky.pcb.tsx', 'Q1')
  assert.equal(q1.code, 0, q1.stderr)
  const lines = q1.stdout.trim().split('\n')
  assert.match(lines[0], /^Blinky 0\.1\.0  blinky\.pcb\.tsx  mm, x right, y down, rotation counter-clockwise on screen$/)
  assert.match(lines[1], /^outline  x 0\.00 to 30\.00, y 0\.00 to 20\.00, 30\.00 x 20\.00  copper F\.Cu B\.Cu$/)
  assert.match(lines[2], /^Q1  \S+  \S+  at \(26\.00, 10\.00\)  rot 0  side F  model generated  blinky\.pcb\.tsx:\d+:\d+$/)
  assert.match(lines[3], /^  pad\s+name\s+net\s+centre\s+size\s+layers$/)
  assert.equal(lines.length, 7)
  assert.match(q1.stdout, /^  3\s+\S+\s+SW\s+\(27\.00, 10\.00\)/m)
  const pad = await cli(DEMO, 'inspect', 'blinky.pcb.tsx', 'Q1.3', '--json')
  const j = JSON.parse(pad.stdout)
  assert.deepEqual(j.pads.map(p => [p.num, p.net, p.at]), [['3', 'SW', [27, 10]]])
  assert.deepEqual(j.frame.copper, ['F.Cu', 'B.Cu'])
  const path = await cli(DEMO, 'inspect', 'blinky.pcb.tsx', 'CH2/R')
  assert.match(path.stdout, /^R2 \(CH2\/R\)  /m)
  const gnd = await cli(DEMO, 'inspect', 'blinky.pcb.tsx', 'GND')
  assert.match(gnd.stdout, /^net GND  3 pads, 1 via, \d+ tracks?, 1 zone on B\.Cu  copper F\.Cu \d+\.\d mm², B\.Cu \d+\.\d mm²$/m)
  const all = await cli(DEMO, 'inspect', 'blinky.pcb.tsx')
  assert.match(all.stdout, /^  R2\s+CH2\/R\s+330\s+\(12\.00, 10\.00\)/m)
  const none = await cli(DEMO, 'inspect', 'blinky.pcb.tsx', 'NOPE')
  assert.equal(none.code, 1)
  assert.match(none.stdout, /^no footprint, pad or net named NOPE$/m)
})

// ---- check against a throwaway project: a clean board, a board with a short, a module that throws ----
const board = (name, second) => `import PCB from '@pcbjs/core'
export default (
  <PCB name="${name}" revision="1.0" copper={2} rules={{ clearance: 0.2, minTrackWidth: 0.2 }}>
    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />
    <footprint ref="TP1" value="V" id="pcbjs:TestPad-2mm" at="5mm 10mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>
    <footprint ref="TP2" value="V" id="pcbjs:TestPad-2mm" at="15mm 10mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>
    <track net="V" layer="F.Cu" width={0.5} d="M 5 10 H 15" />
    ${second}
  </PCB>
)
`
let root
before(() => {
  root = mkdtempSync(join(tmpdir(), 'pcbjs-check-'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(resolve(PKG, '..', '..', 'node_modules', '@pcbjs'), join(root, 'node_modules', '@pcbjs'), 'dir')
  writeFileSync(join(root, 'clean.tsx'), board('Clean', ''))
  writeFileSync(join(root, 'short.tsx'), board('Short', '<footprint ref="TP3" value="W" id="pcbjs:TestPad-2mm" at="10mm 10.5mm" net:pad1="W" bom={false}><pad num={1} size={2} shape="circle" /></footprint>'))
  writeFileSync(join(root, 'throws.tsx'), "import PCB from '@pcbjs/core'\nconst x = undefinedThing\nexport default <PCB name=\"T\" />\n")
  // two routes made by one helper, called from lines 9 and 10
  writeFileSync(join(root, 'helper.tsx'), [
    "import PCB, { route } from '@pcbjs/core'",
    "const tie = (y: number) => route('5 10', `8 ${y}`, 'Z').net('V').width(0.3)",
    'export default (',
    '  <PCB name="Helper" revision="1.0" copper={2}>',
    '    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />',
    '    <footprint ref="TP1" value="V" id="pcbjs:TestPad-2mm" at="5mm 10mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>',
    '    <footprint ref="TP2" value="V" id="pcbjs:TestPad-2mm" at="8mm 10mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>',
    '    <footprint ref="TP3" value="V" id="pcbjs:TestPad-2mm" at="8mm 14mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>',
    '    {tie(10)}',
    '    {tie(14)}',
    '  </PCB>',
    ')',
  ].join('\n') + '\n')
})

test('inspect: a route made inside a helper names the call site, then the route call; --lengths filters; a net lists its track widths', async () => {
  const r = await cli(root, 'inspect', 'helper.tsx', '--lengths')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^  route:1 +V .* helper\.tsx:9:6 via helper\.tsx:2:28$/m)
  assert.match(r.stdout, /^  route:2 +V .* helper\.tsx:10:6 via helper\.tsx:2:28$/m)
  const f = await cli(root, 'inspect', 'helper.tsx', '--lengths', 'NOPE')
  assert.match(f.stdout, /^no route of the net, pair or group NOPE$/m)
  const n = await cli(root, 'inspect', 'helper.tsx', 'V')
  assert.match(n.stdout, /^  track +layer +width +length +from +to +route$/m)
  assert.match(n.stdout, /^  #\d+ +F\.Cu +0\.3 +3\.00 +\(5\.00, 10\.00\) +\(8\.00, 10\.00\) +route:1$/m)
  const j = JSON.parse((await cli(root, 'inspect', 'helper.tsx', 'V', '--json')).stdout)
  assert.deepEqual(j.tracks.find(t => t.route === 'route:2').pts, [[5, 10], [8, 14]])
})
test('inspect: a route made in a .map callback inside a helper names the helper\'s call site; an inline .map route names none', async () => {
  writeFileSync(join(root, 'maps.tsx'), [
    "import PCB, { route } from '@pcbjs/core'",
    'function ties(y: number) {',
    '  return [0].map(() => route(\'5 10\', `8 ${y}`, \'Z\').net(\'V\').width(0.3))',
    '}',
    'export default (',
    '  <PCB name="Maps" revision="1.0" copper={2}>',
    '    <circle layer="Edge.Cuts" cx={10} cy={10} r={10} />',
    '    <footprint ref="TP1" value="V" id="pcbjs:TestPad-2mm" at="5mm 10mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>',
    '    <footprint ref="TP2" value="V" id="pcbjs:TestPad-2mm" at="8mm 10mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>',
    '    <footprint ref="TP3" value="V" id="pcbjs:TestPad-2mm" at="8mm 14mm" net:pad1="V" bom={false}><pad num={1} size={2} shape="circle" /></footprint>',
    '    {[10, 14].map(ties)}',
    '    {[10].map(y => [',
    '      route(\'5 10\', `8 ${y}`, \'Z\').net(\'V\').width(0.25),',
    '    ])}',
    '  </PCB>',
    ')',
  ].join('\n') + '\n')
  const r = await cli(root, 'inspect', 'maps.tsx', '--lengths')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^  route:1 +V .* maps\.tsx:11:15 via maps\.tsx:3:24$/m)
  assert.match(r.stdout, /^  route:2 +V .* maps\.tsx:11:15 via maps\.tsx:3:24$/m)
  assert.match(r.stdout, /^  route:3 +V .* maps\.tsx:13:7$/m)
})
after(() => { if (root) rmSync(root, { recursive: true, force: true }) })

test('check: exit 0 when clean, without fab files or a site', async () => {
  const r = await cli(root, 'check', 'clean.tsx')
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /^Clean 1\.0  clean\.tsx  2 footprints, .*  DRC ok  ERC ok  \d+ ms/m)
  assert.match(r.stdout.trim().split('\n').at(-1), /^ok\s+DRC 0 errors/)
  assert.ok(!existsSync(join(root, '.pcbjs', 'fab')))
  assert.ok(!existsSync(join(root, '.pcbjs', 'dist')))
  assert.doesNotMatch(r.stdout + r.stderr, /vite|transforming|kB/)
})

test('check: exit 1 on DRC errors, every finding listed, --json with the same ids on every run', async () => {
  const r = await cli(root, 'check', 'clean.tsx', 'short.tsx', '--json', 'out/report.json')
  assert.equal(r.code, 1)
  assert.match(r.stdout, /^Short 1\.0  short\.tsx  .*FAIL/m)
  assert.match(r.stdout, /^  DRC short: \d+ errors?$/m)
  assert.match(r.stdout, /^    error    short  F\.Cu  at \(\d+\.\d\d, \d+\.\d\d\)  TP\d(, TP\d)?  short\.tsx:\d+:\d+: /m)
  assert.match(r.stdout, /^    warning  single-pad  at \(10\.00, 10\.50\)  TP3  short\.tsx:\d+:\d+: net W has only one pad$/m)
  assert.match(r.stdout, /^json   out\/report\.json$/m)
  const one = JSON.parse(readFileSync(join(root, 'out', 'report.json'), 'utf8'))
  assert.deepEqual(one.boards.map(b => [b.name, b.status]), [['Clean', 'ok'], ['Short', 'fail']])
  const s = one.boards[1]
  for (const k of ['name', 'target', 'stats', 'timings', 'drc', 'erc', 'status', 'fab', 'pages']) assert.ok(k in s, k)
  assert.ok(s.drc.length > 0)
  for (const f of s.drc) assert.match(f.id, /^[0-9a-f]{12}$/)
  await cli(root, 'check', 'short.tsx', '--json', 'out/again.json')
  const two = JSON.parse(readFileSync(join(root, 'out', 'again.json'), 'utf8'))
  assert.deepEqual(two.boards[0].drc.map(f => f.id), s.drc.map(f => f.id))
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

test('docs --grep: plain words are a substring, anything else a regular expression', async () => {
  const r = await cli(root, 'docs', '--grep', 'single-pad|route-failed')
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /single-pad/)
  assert.match(r.stdout, /route-failed/)
  // a pattern that does not parse falls back to a substring
  assert.equal((await cli(root, 'docs', '--grep', 'route(')).code, 0)
})
