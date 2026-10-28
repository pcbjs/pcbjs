import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileBoard } from '@pcbjs/compile'
import { siteData } from '@pcbjs/export/site-data'
import { boardSvg } from '@pcbjs/export/svg'
import { jsxDEV } from '@pcbjs/core/jsx-dev-runtime'
import { route } from '@pcbjs/core'
import { PCB, h, outline } from './fixtures.mjs'
import { sourceTarget } from '@pcbjs/viewer/src/source.ts'

const S = (file, line, col, endLine, endCol) => ({ file, line, col, endLine, endCol })
const G = S('main.tsx', 10, 3, 20, 7)
const CALL = S('main.tsx', 11, 5, 11, 40)
const ROUTE = S('main.tsx', 12, 5, 12, 60)
const AUTO = S('main.tsx', 13, 5, 13, 70)
const FP = S('lib/Part.tsx', 3, 10, 6, 20)
const PAD1 = S('lib/Part.tsx', 4, 5, 4, 30)
const PAD2 = S('lib/Part.tsx', 5, 5, 5, 30)
const DEV = { fileName: '/proj/main.tsx', lineNumber: 30, columnNumber: 3 }

// The component spreads its props after its own __src: an outer __src that leaked would replace the inner one.
const Part = props =>
  h(
    'footprint',
    { __src: FP, ...props, fields: { props: Object.keys(props).join(',') } },
    h('pad', { num: 1, size: [1, 1], __src: PAD1 }),
    h('pad', { num: 2, at: [2, 0], size: [1, 1], __src: PAD2 }),
  )

function design(withSrc = true) {
  const s = v => (withSrc ? { __src: v } : {})
  return h(
    PCB,
    { name: 'Src', ...s(S('main.tsx', 1, 1, 40, 1)) },
    outline(),
    h(
      'g',
      { at: '3 3', ...s(G) },
      h(Part, { ref: 'U1', 'net:1': 'A', 'net:2': 'A', ...s(CALL) }),
      route({ net: 'A', layer: 'B.Cu', width: 0.3, d: 'M 0 0 L 2 0', ...s(ROUTE) }),
      route({ net: 'A', layer: 'F.Cu', width: 0.3, d: { start: 'U1.1', end: 'U1.2', algorithm: 'straight' }, ...s(AUTO) }),
    ),
    jsxDEV('via', { net: 'B', at: '8 8' }, undefined, false, DEV),
  )
}

const site = board => siteData(board, { root: '/proj', fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', dev: true, bom: [] })
const range = s => ({ start: [s.line, s.col], end: [s.endLine, s.endCol] })

test('source index: footprint src is the outer call site, its chain runs outer to inner', () => {
  const b = compileBoard(design())
  const [fp] = b.footprints
  assert.deepEqual(fp.src, CALL)
  assert.deepEqual(fp.chain, [G, CALL, FP])
  const pad1 = b.items.find(i => i.kind === 'pad' && i.num === '1')
  assert.deepEqual(pad1.src, PAD1)
  assert.deepEqual(pad1.chain, [G, CALL, FP])
})

test('source index: helper calls give their range to their items, autorouted ones included', () => {
  const b = compileBoard(design())
  const tracks = b.items.filter(i => i.kind === 'track')
  const explicit = tracks.filter(t => t.layer === 'B.Cu')
  const routed = tracks.filter(t => t.layer === 'F.Cu')
  assert.equal(explicit.length, 1)
  assert.ok(routed.length >= 1)
  assert.deepEqual(explicit[0].src, ROUTE)
  assert.deepEqual(explicit[0].chain, [G])
  for (const t of routed) {
    assert.deepEqual(t.src, AUTO)
    assert.deepEqual(t.chain, [G])
  }
})

test('source index: __src never reaches props, fields or the compiled board', () => {
  const b = compileBoard(design())
  assert.equal(b.footprints[0].fields.props, 'ref,net:1,net:2')
  assert.ok(!JSON.stringify(b).includes('__src'))
  assert.ok(!JSON.stringify(site(b)).includes('__src'))
})

test('source index: ranges per file, sorted outer first, with ids and refs', () => {
  const b = compileBoard(design())
  const sd = site(b)
  const ids = pred =>
    b.items
      .filter(pred)
      .map(i => i.id)
      .sort((x, y) => x - y)
  const pads = ids(i => i.kind === 'pad')
  const routed = ids(i => i.kind === 'track' && i.layer === 'F.Cu')
  const explicit = ids(i => i.kind === 'track' && i.layer === 'B.Cu')
  const via = ids(i => i.kind === 'via')
  // the silk ref of U1 belongs to its placement, like its pads
  const silk = ids(i => i.kind === 'text' && i.text === 'U1')
  assert.equal(silk.length, 1)
  const part = [...pads, ...silk]
  const all = [...part, ...explicit, ...routed].sort((x, y) => x - y)
  // `outer`: the ids a range reaches only as a call site around the code that drew them; the silk ref is drawn by the call
  assert.deepEqual(sd.sources['main.tsx'], [
    { ...range(G), ids: all, outer: all, refs: ['U1'] },
    { ...range(CALL), ids: part, outer: pads, refs: ['U1'] },
    { ...range(ROUTE), ids: explicit, refs: [] },
    { ...range(AUTO), ids: routed, refs: [] },
    { start: [30, 3], end: [30, 3], ids: via, refs: [] },
  ])
  assert.deepEqual(sd.sources['lib/Part.tsx'], [
    { ...range(FP), ids: part, outer: part, refs: ['U1'] },
    { ...range(PAD1), ids: [pads[0]], refs: [] },
    { ...range(PAD2), ids: [pads[1]], refs: [] },
  ])
  assert.deepEqual(sd.footprints[0].src, { file: 'main.tsx', line: 11, col: 5, endLine: 11, endCol: 40, abs: '/proj/main.tsx' })
  assert.deepEqual(sd.footprints[0].def, { file: 'lib/Part.tsx', line: 3, col: 10, endLine: 6, endCol: 20, abs: '/proj/lib/Part.tsx' })
})

test('source index: cmd+click opens the placement, shift+cmd+click the definition, a track its own range', () => {
  const b = compileBoard(design())
  const sd = site(b)
  const pad1 = b.items.find(i => i.kind === 'pad' && i.num === '1')
  const track = b.items.find(i => i.kind === 'track' && i.layer === 'B.Cu')
  const at = t => `${t.file}:${t.start.join(':')}-${t.end.join(':')}`
  assert.equal(at(sourceTarget(sd, { id: pad1.id, ref: 'U1' }, 'placement')), 'main.tsx:11:5-11:40')
  assert.equal(at(sourceTarget(sd, { id: pad1.id, ref: 'U1' }, 'definition')), 'lib/Part.tsx:4:5-4:30')
  assert.equal(at(sourceTarget(sd, { ref: 'U1' }, 'placement')), 'main.tsx:11:5-11:40')
  assert.equal(at(sourceTarget(sd, { ref: 'U1' }, 'definition')), 'lib/Part.tsx:3:10-6:20')
  assert.equal(at(sourceTarget(sd, { id: track.id, ref: null }, 'placement')), 'main.tsx:12:5-12:60')
  assert.equal(at(sourceTarget(sd, { id: track.id, ref: null }, 'definition')), 'main.tsx:12:5-12:60')
})

test('source index: every indexed id is a data-id in the layer SVG', () => {
  const sd = site(compileBoard(design()))
  const svgIds = new Set(
    [
      ...sd.layers
        .map(l => l.svg)
        .join('')
        .matchAll(/data-id="(\d+)"/g),
    ].map(m => Number(m[1])),
  )
  const indexed = Object.values(sd.sources)
    .flat()
    .flatMap(r => r.ids)
  assert.ok(indexed.length)
  for (const id of indexed) assert.ok(svgIds.has(id), `id ${id} in the SVG`)
})

test('source index: a start-only jsxDEV board still indexes, end equal to start', () => {
  const at = (line, col) => ({ fileName: '/proj/main.tsx', lineNumber: line, columnNumber: col })
  const Dev = props =>
    jsxDEV('footprint', { ...props, children: jsxDEV('pad', { num: 1, size: [1, 1] }, undefined, false, { ...at(2, 9), fileName: '/proj/lib/Dev.tsx' }) }, undefined, false, {
      ...at(1, 9),
      fileName: '/proj/lib/Dev.tsx',
    })
  const b = compileBoard(h(PCB, { name: 'Dev' }, outline(), jsxDEV(Dev, { ref: 'D1', at: '5 5' }, undefined, false, at(7, 5))))
  const sd = site(b)
  const pad = b.items.find(i => i.kind === 'pad')
  const ref = b.items.find(i => i.kind === 'text' && i.text === 'D1')
  assert.deepEqual(sd.sources['main.tsx'], [{ start: [7, 5], end: [7, 5], ids: [pad.id, ref.id], outer: [pad.id], refs: ['D1'] }])
  assert.deepEqual(sd.sources['lib/Dev.tsx'], [
    { start: [1, 9], end: [1, 9], ids: [pad.id, ref.id], outer: [pad.id, ref.id], refs: ['D1'] },
    { start: [2, 9], end: [2, 9], ids: [pad.id], refs: [] },
  ])
  assert.deepEqual(sd.footprints[0].src, { file: 'main.tsx', line: 7, col: 5, abs: '/proj/main.tsx' })
  assert.equal(sd.footprints[0].def, undefined)
})

test('source index: the pcb.svg document does not change with source ranges', () => {
  assert.equal(boardSvg(compileBoard(design(true))), boardSvg(compileBoard(design(false))))
})

test('source index: text items keep their src and are data-ids in the layer SVG', () => {
  const T = S('main.tsx', 20, 5, 20, 40)
  const b = compileBoard(h(PCB, { name: 'Txt' }, outline(), h('g', { at: '2 2', __src: G }, h('text', { layer: 'F.SilkS', at: '3 3', __src: T }, 'hi'))))
  const t = b.items.find(i => i.kind === 'text')
  assert.deepEqual(t.src, T)
  assert.deepEqual(t.chain, [G])
  assert.ok(t.strokes.length > 0)
  const svg = site(b).layers.find(l => l.id === 'F.SilkS').svg
  assert.match(svg, new RegExp(`<path data-id="${t.id}" data-kind="text"`))
})
