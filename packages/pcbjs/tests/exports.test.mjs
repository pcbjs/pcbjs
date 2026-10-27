import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerberLayer } from '@pcbjs/export/gerber'
import { buildFab } from '@pcbjs/export/fab'
import { union, polysToRings } from '@pcbjs/compile/geom'
import { excellon } from '@pcbjs/export/excellon'
import { bomCsv, bomRows } from '@pcbjs/export/bom'
import { boardSvg, layerMarkup } from '@pcbjs/export/svg'
import { siteData } from '@pcbjs/export/site-data'
import { compiledBase, bomBoard, baseBoard, compileBoard, h, PCB } from './fixtures.mjs'

const DATE = '2026-01-01T00:00:00Z'

test('gerber: F.Cu header, flashes, and end of file', () => {
  const g = gerberLayer(compiledBase(), 'F.Cu', DATE)
  assert.ok(g)
  assert.ok(g.text.includes('%FSLAX46Y46*%'))
  assert.ok(g.text.includes('%MOMM*%'))
  assert.match(g.text, /D03\*/)
  assert.ok(g.text.trimEnd().endsWith('M02*'))
  assert.ok(g.text.includes('%TF.FileFunction,Copper,L1,Top*%'), `got ${g.text.match(/%TF.FileFunction[^\n]*/)?.[0]}`)
})

test('gerber: B.Cu is the bottom copper layer', () => {
  const g = gerberLayer(compiledBase(), 'B.Cu', DATE)
  assert.ok(g.text.includes('%TF.FileFunction,Copper,L2,Bot*%'), `got ${g.text.match(/%TF.FileFunction[^\n]*/)?.[0]}`)
})

test('gerber: Y is negated relative to the model (Gerber y is up)', () => {
  const g = gerberLayer(compiledBase(), 'F.Cu', DATE)
  // J1 pad 2 is a round pad at model (2, 4.54): flashed at Y = -4.54 mm in 4.6 format
  assert.ok(g.text.includes('X2000000Y-4540000D03*'))
  // the A track runs from model (2, 2) to (7, 2)
  assert.ok(g.text.includes('X2000000Y-2000000D02*'))
  assert.ok(g.text.includes('X7000000Y-2000000D01*'))
})

test('excellon: plated holes of the two headers', () => {
  const d = excellon(compiledBase(), true, DATE)
  assert.ok(d)
  assert.deepEqual(d.tools.map(({ d, count, slots, vias }) => ({ d, count, slots, vias })), [{ d: 1, count: 4, slots: 0, vias: 0 }])
  assert.equal(d.tools[0].holes.length, 4)
  const lines = d.text.split('\n')
  assert.ok(lines.includes('T1C1.000'))
  assert.ok(lines.includes('METRIC,TZ'))
  const holes = lines.filter(l => /^X-?[\d.]+Y-?[\d.]+$/.test(l))
  assert.equal(holes.length, 4)
  assert.ok(holes.includes('X2.000Y-2.000'))
  assert.ok(holes.includes('X7.000Y-4.540'))
  assert.equal(excellon(compiledBase(), false, DATE), null, 'no non-plated holes')
})

test('bom: equal parts are grouped', () => {
  const b = bomBoard()
  const rows = bomRows(b)
  assert.deepEqual(rows.map(r => [[...r.refs].sort().join(' '), r.value, r.footprint, r.qty]),
    [['J1', 'Conn_01x02', 'pcbjs:PinHeader_1x02_P2.54mm_Vertical', 1], ['R1 R2', '10k', 'pcbjs:R_0603_1608Metric', 2], ['R3', '1k', 'pcbjs:R_0603_1608Metric', 1]])
  const csv = bomCsv(b).trimEnd().split('\n')
  assert.equal(csv[0], 'Refs,Value,Footprint,Qty,MPN,Source,Manufacturer,Datasheet')
  assert.equal(csv.length, 4)
  assert.match(csv[2], /^R\d R\d,10k,pcbjs:R_0603_1608Metric,2,,,,$/)
})

test('bom: refs within a group are in natural order', () => {
  // R2 is declared before R1 in the design
  const csv = bomCsv(bomBoard()).trimEnd().split('\n')
  assert.equal(csv[2], 'R1 R2,10k,pcbjs:R_0603_1608Metric,2,,,,')
})

test('svg: board document with pcb namespace and layer groups', () => {
  const s = boardSvg(compiledBase())
  assert.ok(s.startsWith('<?xml'))
  assert.ok(s.includes('xmlns:pcb="https://pcb.svg/ns/1"'))
  assert.ok(s.includes('<g pcb:layer="F.Cu"'))
  assert.ok(s.includes('<g pcb:layer="Edge.Cuts"'))
  assert.match(s, /<pcb:footprint ref="J1"/)
})

test('svg: every element of the layer markup carries data-kind', () => {
  const board = compiledBase()
  const kinds = new Set()
  for (const l of board.layers) {
    for (const m of layerMarkup(board, l.id).matchAll(/<(path|circle|rect|text)\b([^>]*)>/g)) {
      const k = /data-kind="([a-z]+)"/.exec(m[2])
      assert.ok(k, `no data-kind on <${m[1]}${m[2]}> in ${l.id}`)
      assert.ok(['pad', 'track', 'via', 'zone', 'graphic', 'text'].includes(k[1]), k[1])
      kinds.add(k[1])
    }
  }
  for (const k of ['pad', 'track', 'graphic']) assert.ok(kinds.has(k), `no ${k} in the base board`)
  assert.match(layerMarkup(board, 'F.Cu'), /<path data-id="\d+" data-kind="pad"[^>]* data-pad="1"/)
})

test('site data: each footprint has a bbox in board mm around its pads and graphics', () => {
  const board = compiledBase()
  const site = siteData(board, { root: '/', fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', dev: false, bom: [] })
  for (const fp of site.footprints) {
    const b = fp.bbox
    assert.ok(b.w > 0 && b.h > 0, fp.ref)
    for (const p of fp.pads) assert.ok(p.at[0] >= b.x && p.at[0] <= b.x + b.w && p.at[1] >= b.y && p.at[1] <= b.y + b.h, `${fp.ref}.${p.num} outside its bbox`)
    assert.ok(fp.body && typeof fp.height === 'number', 'other fields are kept')
  }
})

test('gerber: closed outlines, a rect and a path that returns to its start, have no zero-length D01 segment', () => {
  const pathBoard = compileBoard(h(PCB, { name: 'T' }, h('path', { layer: 'Edge.Cuts', d: 'M0 0 H10 V10 H0 V0 Z' })))
  for (const board of [compiledBase(), pathBoard]) {
    const lines = gerberLayer(board, 'Edge.Cuts', DATE).text.split('\n')
    // four sides, each drawn exactly once
    assert.equal(lines.filter(l => l.endsWith('D01*')).length, 4)
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].endsWith('D01*')) assert.notEqual(lines[i], lines[i - 1], `zero-length segment at line ${i}: ${lines[i]}`)
    }
  }
})

test('gerber job: lists the PTH drill file with a Plated,1,2 file function', () => {
  const fab = buildFab(compiledBase(), DATE)
  const job = JSON.parse(fab.files['Test-job.gbrjob'])
  const pth = job.FilesAttributes.find(f => f.Path === 'Test-PTH.drl')
  assert.ok(pth, 'PTH drill file in FilesAttributes')
  assert.ok(pth.FileFunction.startsWith('Plated,1,2'), `got ${pth.FileFunction}`)
  assert.equal(pth.FilePolarity, 'Positive')
  assert.ok(!job.FilesAttributes.some(f => f.Path === 'Test-NPTH.drl'), 'no NPTH entry without an NPTH file')
})

test('excellon: header declares METRIC,TZ', () => {
  const lines = excellon(compiledBase(), true, DATE).text.split('\n')
  const header = lines.slice(0, lines.indexOf('%'))
  assert.ok(header.includes('METRIC,TZ'))
  assert.ok(!header.includes('METRIC'))
})

test('gerber: two overlapping GND zones on B.Cu are written as one unioned region with a single clear block', () => {
  // the zones overlap on x 4..6; a via of net B in the overlap cuts a hole into both fills
  const b = compileBoard(baseBoard([
    h('zone', { net: 'GND', layer: 'B.Cu', d: 'M0 6 H6 V10 H0 Z', islands: 'keep' }),
    h('zone', { net: 'GND', layer: 'B.Cu', d: 'M4 6 H10 V10 H4 Z', islands: 'keep' }),
    h('via', { net: 'B', at: '5 8' }),
  ]))
  const zones = b.items.filter(i => i.kind === 'zone')
  assert.equal(zones.length, 2)
  // written separately this would be two dark outers and two clear blocks
  assert.deepEqual(zones.map(z => [z.fill.length, z.fill[0].holes.length]), [[1, 1], [1, 1]])
  const merged = union(zones.flatMap(z => polysToRings(z.fill)))
  assert.equal(merged.length, 1)
  assert.equal(merged[0].holes.length, 1)
  const lines = gerberLayer(b, 'B.Cu', DATE).text.split('\n')
  const body = lines.slice(lines.indexOf('G04 APERTURE END LIST*') + 1)
  assert.equal(body.filter(l => l === '%LPC*%').length, 1, 'one clear block')
  const lpc = body.indexOf('%LPC*%'), back = body.indexOf('%LPD*%', lpc)
  assert.equal(body.slice(0, lpc).filter(l => l === 'G36*').length, 1, 'one dark zone outer before the clear block')
  assert.equal(body.slice(lpc, back).filter(l => l === 'G36*').length, 1, 'one hole in the clear block')
})

// ---------- stroke-font text ----------

const textBoard = (extra = []) => compileBoard(baseBoard([
  h('text', { layer: 'F.SilkS', at: '5 8', size: 1 }, 'HI'),
  h('text', { layer: 'B.SilkS', at: '5 8', size: 1, anchor: 'start' }, 'C1'),
  ...extra,
]))

test('text: silk text is written to the legend Gerbers as D01 strokes of a round aperture', () => {
  const b = textBoard()
  const t = b.items.find(i => i.kind === 'text' && i.layer === 'F.SilkS')
  assert.equal(t.thickness, b.rules.silkMinWidth)
  const g = gerberLayer(b, 'F.SilkS', DATE).text
  const ap = /%ADD(\d+)C,0\.1500\*%/.exec(g)
  assert.ok(ap, 'no C aperture of the text thickness')
  const body = g.slice(g.indexOf(`D${ap[1]}*`))
  assert.ok((body.match(/D01\*/g) ?? []).length >= 4, 'too few D01 lines')
  // every text vertex is in the file, y negated
  const [x, y] = t.strokes[0][0]
  assert.ok(g.includes(`X${Math.round(x * 1e6)}Y${Math.round(-y * 1e6)}`))
  assert.match(gerberLayer(b, 'B.SilkS', DATE).text, /D01\*/)
})

test('text: the SVG draws text as a stroked path, never a <text> element', () => {
  const b = textBoard()
  const m = layerMarkup(b, 'F.SilkS')
  assert.doesNotMatch(m, /<text\b/)
  assert.match(m, /<path data-id="\d+" data-kind="text"[^>]* fill="none" stroke="currentColor" stroke-width="0\.15" stroke-linecap="round" stroke-linejoin="round" d="M/)
  assert.doesNotMatch(m, /pcb:text/)
  const doc = boardSvg(b)
  assert.doesNotMatch(doc, /<text\b/)
  assert.match(doc, /data-kind="text"[^>]* pcb:text="HI"/)
  assert.match(doc, /pcb:text="C1"/)
})

test('text: back text is mirrored, front text is not, and at is the vertical centre', () => {
  const b = textBoard()
  const f = b.items.find(i => i.kind === 'text' && i.layer === 'F.SilkS')
  const k = b.items.find(i => i.kind === 'text' && i.layer === 'B.SilkS')
  assert.equal(f.mirrored, false)
  assert.equal(k.mirrored, true)
  const xs = s => s.strokes.flat().map(p => p[0]), ys = s => s.strokes.flat().map(p => p[1])
  // front, anchor middle: centred on x = 5; caps from 7.5 to 8.5
  assert.ok(Math.abs((Math.min(...xs(f)) + Math.max(...xs(f))) / 2 - 5) < 0.05)
  assert.ok(Math.abs(Math.min(...ys(f)) - 7.5) < 1e-6 && Math.abs(Math.max(...ys(f)) - 8.5) < 1e-6)
  // back, anchor start, mirrored: the text runs to the left of at
  assert.ok(Math.max(...xs(k)) <= 5 + 1e-6 && Math.min(...xs(k)) < 4)
})

test('text: a thinner silk thickness is raised to silkMinWidth; other layers keep theirs', () => {
  const b = textBoard([h('text', { layer: 'F.SilkS', at: '5 5', thickness: 0.05 }, 'T'), h('text', { layer: 'F.Fab', at: '5 5', thickness: 0.05 }, 'T'), h('text', { layer: 'F.Fab', at: '5 5' }, 'U')])
  const ts = b.items.filter(i => i.kind === 'text')
  assert.equal(ts.find(t => t.layer === 'F.SilkS' && t.text === 'T').thickness, b.rules.silkMinWidth)
  assert.equal(ts.find(t => t.layer === 'F.Fab' && t.text === 'T').thickness, 0.05)
  assert.equal(ts.find(t => t.text === 'U').thickness, 0.15)
  assert.ok(!b.drc.some(d => d.rule === 'silk-width'))
})

test('text: silk-over-pad sees text strokes', () => {
  // J1 pad 1 is at (2, 2)
  const b = compileBoard(baseBoard([h('text', { layer: 'F.SilkS', at: '2 2', size: 1 }, 'X')]))
  const hit = b.drc.find(d => d.rule === 'silk-over-pad')
  assert.ok(hit, 'no silk-over-pad for text on a pad')
  assert.match(hit.message, /text "X"/)
})

test('text: copper text is copper for clearance and the Gerber', () => {
  const b = compileBoard(baseBoard([h('text', { layer: 'F.Cu', at: '4.5 2', size: 1 }, 'X')]))
  assert.ok(b.drc.some(d => (d.rule === 'short' || d.rule === 'clearance') && d.message.includes('text')), b.drc.map(d => d.rule).join(','))
  assert.ok(gerberLayer(b, 'F.Cu', DATE).text.includes('C,0.1500'))
})

test('text: an unknown font is a compile error', () => {
  assert.throws(() => compileBoard(baseBoard([h('text', { layer: 'F.SilkS', at: '5 8', font: 'arial' }, 'x')])), /font "arial"/)
})

test('fab: README-fab names the stroke font and the text thickness', () => {
  const fab = buildFab(textBoard(), DATE)
  assert.match(fab.readme, /Hershey Simplex/)
  assert.match(fab.readme, /0\.15 mm/)
  assert.doesNotMatch(fab.readme, /SVG only/)
})
