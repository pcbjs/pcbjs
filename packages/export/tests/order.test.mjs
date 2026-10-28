// Fix round 3: holes cut into filled graphics, the order package, reproducible dates, CPL origins and skipped empty paste.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { area, intersection, polysToRings } from '@pcbjs/compile/geom'
import { buildFab, cutIn, gerberLayer, readGerber } from '../dist/index.js'

const DATE = '2026-01-01T00:00:00.000Z'
const disc = (cx, cy, r, n = 32) =>
  'M ' + Array.from({ length: n }, (_, i) => `${cx + r * Math.cos((2 * Math.PI * i) / n)} ${cy + r * Math.sin((2 * Math.PI * i) / n)}`).join(' L ') + ' Z'
/** a square ring around (10, 10), its hole drawn the other way so the union keeps it */
const RING = 'M 6 6 H 14 V 14 H 6 Z M 8 8 V 12 H 12 V 8 Z'

/** A © mark: a small disc, then a filled ring with a hole around it, on one layer. */
function copyright(layer = 'F.SilkS') {
  return compileBoard(
    h(
      PCB,
      { name: 'Copy' },
      h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 20 V 20 H 0 Z' }),
      h('path', { layer, d: disc(10, 10, 1), fill: true }),
      h('path', { layer, d: RING, fill: true }),
    ),
  )
}
const inkNear = (polys, r) =>
  area(
    polysToRings(
      intersection(polysToRings(polys), [
        [
          [10 - r, 10 - r],
          [10 + r, 10 - r],
          [10 + r, 10 + r],
          [10 - r, 10 + r],
        ],
      ]),
    ),
  )

test('gerber: a filled path with a hole no longer erases the earlier disc inside it, the c of the © sign', () => {
  resetDefaults()
  for (const layer of ['F.SilkS', 'F.Cu', 'B.SilkS']) {
    const g = gerberLayer(copyright(layer), layer, DATE)
    assert.doesNotMatch(g.text, /%LPC\*%/, `${layer}: no clear polarity`)
    const read = readGerber(g.text)
    const inner = inkNear(read.polys, 1.5)
    assert.ok(Math.abs(inner - Math.PI) < 0.05, `${layer}: the disc is there, ${inner} mm²`)
    const total = area(polysToRings(read.polys))
    assert.ok(Math.abs(total - (64 - 16 + Math.PI)) < 0.1, `${layer}: ring and disc, ${total} mm²`)
  }
})

test('gerber: cutIn joins several holes and keeps the area', () => {
  const outer = [
    [0, 0],
    [30, 0],
    [30, 10],
    [0, 10],
  ]
  const holes = [
    [
      [2, 2],
      [2, 8],
      [8, 8],
      [8, 2],
    ],
    [
      [12, 2],
      [12, 8],
      [18, 8],
      [18, 2],
    ],
    [
      [22, 2],
      [22, 8],
      [28, 8],
      [28, 2],
    ],
  ]
  const ring = cutIn(outer, holes)
  assert.equal(ring.length, 4 + 3 * 6)
  const a =
    Math.abs(
      ring.reduce((s, p, i) => {
        const q = ring[(i + 1) % ring.length]
        return s + p[0] * q[1] - q[0] * p[1]
      }, 0),
    ) / 2
  assert.equal(a, 300 - 3 * 36)
})

test('gerber: a layer without holes is written as before, region by region', () => {
  const b = compileBoard(
    h(PCB, { name: 'Plain' }, h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 20 V 20 H 0 Z' }), h('path', { layer: 'F.SilkS', d: 'M 2 2 H 6 V 6 H 2 Z', fill: true })),
  )
  const t = gerberLayer(b, 'F.SilkS', DATE).text
  assert.match(t, /%LPD\*%\nG01\*\nG04 APERTURE LIST\*\nG04 APERTURE END LIST\*\nG36\*\n(X\d+Y-?\d+D0[12]\*\n){5}G37\*\nM02\*\n$/)
})

// ---- the order package, dates, the placement origin, paste ----
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import JLC from '@pcbjs/fab/JLCPCB/2-Layer'
import { PinHeader } from '@pcbjs/lib'
import { fabDate, ipc356, cplCsv, siteData, zipFab } from '../dist/index.js'

const smd = (ref, x, net, extra = {}) =>
  h('footprint', { ref, value: 'V', id: 'pcbjs:TestSmd', at: `${x}mm 10mm`, 'net:pad1': net, ...extra }, h('pad', { num: 1, size: 2, shape: 'rect', ...(extra.pad ?? {}) }))
const tht = (ref, x, net) =>
  h('footprint', { ref, value: 'V', id: 'pcbjs:TestTht', at: `${x}mm 10mm`, 'net:pad1': net, bom: false }, h('pad', { num: 1, size: 2, shape: 'circle', drill: 1 }))
const EDGE = h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 40 V 20 H 0 Z' })
const hole = (ref, x, extra = {}) =>
  h(
    'footprint',
    { ref, value: 'M3', id: 'pcbjs:Hole', at: `${x}mm 5mm`, bom: false, pos: false, ...extra },
    h('pad', { num: '', size: 3.2, shape: 'circle', drill: 3.2, type: 'npth' }),
  )

test('order: IPC-D-356A records every pad and via in fixed columns, a long net under an alias', () => {
  resetDefaults()
  const b = compileBoard(
    h(
      PCB,
      { name: 'Ipc', revision: 'A' },
      EDGE,
      tht('J1', 5, 'A_VERY_LONG_NET_NAME'),
      tht('J2', 15, 'A_VERY_LONG_NET_NAME'),
      smd('R1', 25, 'GND'),
      hole('H1', 35),
      h('via', { at: '10 15', net: 'GND' }),
    ),
  )
  const t = ipc356(b, DATE)
  const lines = t.trim().split('\n')
  assert.equal(lines.at(-1), '999')
  assert.ok(lines.includes('P  UNITS CUST 1'))
  assert.ok(lines.includes('P  NNAME1    A_VERY_LONG_NET_NAME'))
  const recs = lines.filter(l => /^3\d\d/.test(l))
  assert.equal(recs.length, 5)
  assert.equal(
    recs.find(l => l.includes('J1')),
    '317NNAME1           J1    -1    D1000PA00X+005000Y-010000X2000Y2000R000S3',
  )
  assert.equal(
    recs.find(l => l.includes('R1')),
    '327GND              R1    -1          A01X+025000Y-010000X2000Y2000R000S1',
  )
  assert.match(
    recs.find(l => l.startsWith('367')),
    /^367N\/C {14}H1 {10}D3200UA00X\+035000Y-005000X3200Y3200R000S\d$/,
  )
  assert.match(
    recs.find(l => l.includes('VIA')),
    /^317GND {14}VIA {8}MD\d{4}PA00X\+010000Y-015000/,
  )
  for (const l of recs) assert.equal(l.slice(41, 42), 'X', l)
})

test('order: the fab set has the netlist, a drill report, a drill map per drill file and a manifest of every file', () => {
  resetDefaults()
  const b = compileBoard(h(PCB, { name: 'Order', revision: '1' }, EDGE, tht('J1', 5, 'A'), tht('J2', 15, 'A'), hole('H1', 35)))
  const fab = buildFab(b, DATE)
  for (const n of ['Order.ipc', 'Order-drill-report.txt', 'Order-PTH-drl_map.svg', 'Order-NPTH-drl_map.svg', 'manifest.json']) assert.ok(fab.files[n], n)
  const rpt = fab.files['Order-drill-report.txt']
  assert.match(rpt, /Order-PTH\.drl: plated through holes, F\.Cu to B\.Cu, 2 holes/)
  assert.match(rpt, /Order-NPTH\.drl: non-plated through holes, F\.Cu to B\.Cu, 1 hole/)
  assert.match(rpt, /T1 +3\.200 +1 +0 +0/)
  const map = fab.files['Order-PTH-drl_map.svg']
  assert.match(map, /^<\?xml/)
  assert.equal((map.match(/<circle /g) ?? []).length, 2)
  assert.doesNotMatch(map, /<text/)
  const man = JSON.parse(fab.files['manifest.json'])
  const names = Object.keys(fab.files)
    .filter(n => n !== 'manifest.json')
    .sort()
  assert.deepEqual(
    man.files.map(f => f.name),
    names,
  )
  for (const f of man.files) assert.equal(f.sha256, createHash('sha256').update(fab.files[f.name]).digest('hex'))
  assert.equal(man.date, DATE)
  assert.match(fab.readme, /manifest\.json/)
  // the zip carries the manifest too
  assert.ok(unzipSync(zipFab(fab))['manifest.json'])
})

test('dates: --date, SOURCE_DATE_EPOCH, then now; one date in every file; zips identical in every time zone', () => {
  assert.equal(fabDate('2026-01-31T12:00:00Z'), '2026-01-31T12:00:00.000Z')
  assert.equal(fabDate(undefined, { SOURCE_DATE_EPOCH: '1769860800' }), '2026-01-31T12:00:00.000Z')
  assert.equal(fabDate('2026-02-01', { SOURCE_DATE_EPOCH: '1769860800' }), '2026-02-01T00:00:00.000Z')
  assert.throws(() => fabDate('yesterday'), /bad date/)
  assert.throws(() => fabDate(undefined, { SOURCE_DATE_EPOCH: 'x' }), /SOURCE_DATE_EPOCH/)
  resetDefaults()
  const make = () => buildFab(compileBoard(h(PCB, { name: 'Same' }, EDGE, tht('J1', 5, 'A'), tht('J2', 15, 'A'), smd('R1', 25, 'A'))), fabDate('2026-01-31T12:00:00Z'))
  const a = make(),
    c = make()
  assert.deepEqual(a.files, c.files)
  for (const [name, text] of Object.entries(a.files)) {
    const dates = text.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g) ?? []
    assert.ok(
      dates.every(d => d === '2026-01-31T12:00:00.000Z'),
      name,
    )
  }
  assert.deepEqual(zipFab(a), zipFab(c))
  // the same zip whatever the machine's time zone
  const script = `import { buildFab, zipFab } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)}
    import { compileBoard } from '@pcbjs/compile'; import PCB, { h } from '@pcbjs/core'
    const b = compileBoard(h(PCB, { name: 'Tz' }, h('path', { layer: 'Edge.Cuts', d: 'M 0 0 H 10 V 10 H 0 Z' })))
    process.stdout.write(Buffer.from(zipFab(buildFab(b, '2026-01-31T23:30:00.000Z'))).toString('hex'))`
  const run = tz => execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: tz }, cwd: new URL('.', import.meta.url) }).toString()
  assert.equal(run('Pacific/Auckland'), run('America/Los_Angeles'))
})

test('cpl: courtyard centre for JLCPCB presets, footprint origin otherwise, the board prop wins; DNP parts left out', () => {
  resetDefaults()
  const make = (Board, props = {}) => {
    const J1 = PinHeader(2)
    return compileBoard(h(Board, { name: 'Cpl', ...props }, EDGE, h(J1, { at: '10 10' }), smd('R1', 25, 'A', { dnp: true })))
  }
  const row = csv =>
    csv
      .split('\n')
      .find(l => l.startsWith('J1,'))
      .split(',')
  const jlc = make(JLC)
  assert.equal(jlc.cpl?.origin, 'center')
  assert.equal(row(cplCsv(jlc))[4], '-11.270')
  assert.equal(row(cplCsv(make(PCB)))[4], '-10.000')
  assert.equal(row(cplCsv(make(JLC, { cpl: { origin: 'footprint' } })))[4], '-10.000')
  assert.equal(row(cplCsv(make(PCB, { cpl: { origin: 'center' } })))[4], '-11.270')
  assert.doesNotMatch(cplCsv(jlc), /^R1,/m)
  assert.match(buildFab(jlc, DATE).readme, /courtyard centre.*DNP parts are left out of it and of bom\.csv: R1/)
  assert.doesNotMatch(buildFab(jlc, DATE).files['bom.csv'], /R1/)
})

test('paste: an empty paste layer is not written and README-fab says so; pads with their own paste windows draw those', () => {
  resetDefaults()
  const b = compileBoard(h(PCB, { name: 'Paste' }, EDGE, tht('J1', 5, 'A'), tht('J2', 15, 'A'), smd('R1', 25, 'A', { pad: { pasteRatio: -0.25 } })))
  const fab = buildFab(b, DATE)
  assert.ok(fab.files['Paste-F_Paste.gtp'])
  assert.equal(fab.files['Paste-B_Paste.gbp'], undefined)
  assert.match(fab.readme, /No paste file for the bottom: no SMD pads with paste on that side/)
  assert.doesNotMatch(fab.files['Paste-job.gbrjob'], /B_Paste/)
  const pad = b.items.find(i => i.kind === 'pad' && i.ref === 'R1')
  const read = readGerber(fab.files['Paste-F_Paste.gtp'])
  const want = pad.pasteRings ? Math.abs(area(pad.pasteRings)) : 4
  assert.ok(Math.abs(Math.abs(area(polysToRings(read.polys))) - want) < 0.01, `paste area ${want}`)
  assert.ok(pad.pasteRings && want < 4, `the pad paste windows, ${want} mm²`)
})

test('site: a bare hole has no body height unless the part sets one', () => {
  resetDefaults()
  const b = compileBoard(h(PCB, { name: 'Holes' }, EDGE, hole('H1', 5), hole('H2', 15, { height: 2 }), tht('J1', 25, 'A')))
  const site = siteData(b, { root: '/', dev: false, fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', bom: [] })
  const hgt = Object.fromEntries(site.footprints.map(f => [f.ref, f.height]))
  assert.deepEqual(hgt, { H1: 0, H2: 2, J1: 1 })
})
