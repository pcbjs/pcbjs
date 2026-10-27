// Segment sync: every command of a path string is an item of its own whose source range is that command's characters.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { siteData } from '@pcbjs/export/site-data'
import { transformSourceRanges } from '@pcbjs/cli/source-ranges'
import { parseRoutePath } from '@pcbjs/compile/route-path'
import { pathCommands } from '@pcbjs/compile/path'
import { commandOf, resolveCursor, highlightLabel, sourceTarget } from '@pcbjs/viewer/src/source.ts'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const smd = (ref, x, y, net) => h('footprint', { ref, at: [x, y], nets: { 1: net } }, h('pad', { num: 1, size: 1, type: 'smd' }))
const site = board => siteData(board, { root: '/p', fabUrl: '', fabName: '', fabFiles: [], fabStatus: 'ok', svgUrl: '', dev: true, bom: [] })

/** The `__src` objects the transform injects into `code`, evaluated, in source order. */
function injected(code, file = 'main.tsx') {
  const out = transformSourceRanges(code, `/p/${file}`, file).code
  return [...out.matchAll(/__src(?:=\{|: )(\{ file: [^}]*?(?:lit: \{[^}]*\}[^}]*)?\})/g)].map(m => Function(`return (${m[1]})`)())
}
/** 1-based line and column of the n-th occurrence of `needle` in `code`. */
function posOf(code, needle, n = 0) {
  let at = -1
  for (let k = 0; k <= n; k++) at = code.indexOf(needle, at + 1)
  assert.ok(at >= 0, `${needle} not found`)
  const before = code.slice(0, at).split('\n')
  return [before.length, before.at(-1).length + 1]
}

const TRACK = `import PCB, { route } from '@pcbjs/core'
export default (
  <PCB name="S">
    {route({ net: 'A', layer: 'F.Cu', width: 0.3, d: 'M 2 2 H 9 V 6 L 12 8' })}
    {route(J1[1], J2[1], 'V 14 L 5 16 @B.Cu H 24 XZ')}
    <track net="B" layer="F.Cu" width={0.2} d="M 1 1 h 2" />
    <zone net="A" layer="B.Cu" d={\`M 0 0 H \${w}\`} />
    {route({ net: 'A', layer: 'F.Cu', width: 0.3, d: 'M 1 1 H "\\u0035"' })}
  </PCB>
)
`

test('segments: the transform injects lit, the first character inside the quotes, and raw for a plain literal', () => {
  const s = injected(TRACK)
  const call = s.find(x => x.line === 4), path = s.find(x => x.line === 5), track = s.find(x => x.line === 6), zone = s.find(x => x.line === 7), esc = s.find(x => x.line === 8)
  const [l1, c1] = posOf(TRACK, "M 2 2")
  assert.deepEqual(call.lit, { line: l1, col: c1 })
  assert.equal(call.raw, true)
  assert.deepEqual(path.lit, { line: 5, col: posOf(TRACK, 'V 14')[1] })
  assert.equal(path.raw, true)
  assert.deepEqual(track.lit, { line: 6, col: posOf(TRACK, 'M 1 1 h')[1] })
  assert.equal(zone.lit, undefined, 'a template with expressions has no lit')
  assert.ok(esc.lit && esc.raw === undefined, 'a literal with escapes has lit but not raw')
  assert.equal(s.find(x => x.line === 3).lit, undefined, 'the board has no path literal')
})

test('segments: path and route path parsers record the characters of each command', () => {
  assert.deepEqual(pathCommands('M 2 2 H 9 V 6 L 12 8').map(c => [c.start, c.end]), [[6, 9], [10, 13], [14, 20]])
  assert.deepEqual(pathCommands('M 0 0 L 1 0 2 0 Z').map(c => 'M 0 0 L 1 0 2 0 Z'.slice(c.start, c.end)), ['L 1 0', '2 0', 'Z'])
  const src = 'V 14 L 5 16 @B.Cu H 24 XZ'
  assert.deepEqual(parseRoutePath(src).map(s => src.slice(...s.at)), ['V 14', 'L 5 16', '@B.Cu', 'H 24', 'XZ'])
})

test('segments: a d with three commands makes three items whose ranges are the commands', () => {
  const [src] = injected(TRACK).filter(x => x.line === 4)
  const b = compileBoard(h(PCB, { name: 'S' }, edge(), route({ net: 'A', layer: 'F.Cu', width: 0.3, d: 'M 2 2 H 9 V 6 L 12 8', __src: src })))
  const ts = b.items.filter(i => i.kind === 'track')
  assert.equal(ts.length, 3)
  const want = [['H 9', 'H 9'], ['V 6', 'V 6'], ['L 12 8', 'L 12 8']]
  ts.forEach((t, k) => {
    const [line, col] = posOf(TRACK, want[k][0])
    assert.equal(t.src.seg, want[k][1])
    assert.deepEqual([t.src.line, t.src.col, t.src.endLine, t.src.endCol], [line, col, line, col + want[k][1].length - 1])
    assert.deepEqual(t.chain.at(-1), { file: 'main.tsx', line: 4, col: src.col, endLine: 4, endCol: src.endCol }, 'the call is innermost in the chain')
  })
  assert.deepEqual(ts[0].pts, [[2, 2], [9, 2]])
  assert.deepEqual(ts[1].pts, [[9, 2], [9, 6]])
  assert.equal(b.unconnected, 0)
})

test('segments: route path commands map to their items, automatic legs included', () => {
  const code = `route(J1[1], J2[1], 'H 8 V 5 @B.Cu H 14 XZ')\n`
  const [src] = injected(`import { route } from '@pcbjs/core'\n${code}`, 'a.ts')
  const b = compileBoard(h(PCB, { name: 'R' }, edge(), smd('J1', 3, 3, 'N'), smd('J2', 20, 12, 'N'),
    route('J1.1', 'J2.1', 'H 8 V 5 @B.Cu H 14 XZ', { __src: src }).width(0.25)))
  const by = seg => b.items.filter(i => (i.kind === 'track' || i.kind === 'via') && i.src?.seg === seg)
  assert.equal(by('H 8').length, 1)
  assert.equal(by('V 5').length, 1)
  assert.deepEqual(by('@B.Cu').map(i => i.kind), ['via'])
  assert.equal(by('H 14').length, 1)
  assert.equal(by('H 14')[0].layer, 'B.Cu')
  const auto = by('XZ')
  assert.ok(auto.length >= 1 && auto.some(i => i.kind === 'track'), 'the automatic leg carries the XZ range')
  const col = s => code.indexOf(s) + 1
  assert.equal(by('V 5')[0].src.col, col('V 5'))
  assert.equal(auto[0].src.col, col('XZ'))
  assert.equal(auto[0].src.endCol, col('XZ') + 1)
  assert.equal(b.items.filter(i => i.kind === 'track' || i.kind === 'via').every(i => i.src?.seg), true, 'every item of the route is one command')
  assert.equal(b.unconnected, 0)
})

test('segments: the source index nests one entry per command inside the call, and the cursor resolves to one command', () => {
  const [src] = injected(TRACK).filter(x => x.line === 4)
  const b = compileBoard(h(PCB, { name: 'S' }, edge(), route({ net: 'A', layer: 'F.Cu', width: 0.3, d: 'M 2 2 H 9 V 6 L 12 8', __src: src })))
  const d = site(b)
  const ranges = d.sources['main.tsx']
  const call = ranges.find(r => r.start[1] === src.col && r.seg === undefined)
  const segs = ranges.filter(r => r.seg !== undefined)
  assert.deepEqual(segs.map(r => r.seg), ['H 9', 'V 6', 'L 12 8'])
  assert.equal(call.ids.length, 3)
  for (const r of segs) {
    assert.ok(r.start[1] > call.start[1] && r.end[1] < call.end[1], 'nested in the call')
    assert.equal(r.ids.length, 1)
  }
  const [line, col] = posOf(TRACK, 'H 9')
  const hit = resolveCursor(d.sources, 'main.tsx', line, col + 1)
  assert.equal(hit.range.seg, 'H 9')
  assert.deepEqual(hit.ids, segs[0].ids)
  // outside every command but inside the call: the whole route
  assert.deepEqual(resolveCursor(d.sources, 'main.tsx', line, src.col + 1).ids.sort(), call.ids)
  // a click opens the command, shift+click the whole call
  const id = segs[1].ids[0]
  assert.deepEqual(sourceTarget(d, { id }, 'placement'), { file: 'main.tsx', start: segs[1].start, end: segs[1].end })
  assert.deepEqual(sourceTarget(d, { id }, 'definition'), { file: 'main.tsx', start: call.start, end: call.end })
})

test('segments: the HUD names the command of a hovered track and the chip reads file:line:col', () => {
  const [src] = injected(TRACK).filter(x => x.line === 4)
  const b = compileBoard(h(PCB, { name: 'S' }, edge(), route({ net: 'A', layer: 'F.Cu', width: 0.3, d: 'M 2 2 H 9 V 6 L 12 8', __src: src })))
  const d = site(b)
  const [first] = b.items.filter(i => i.kind === 'track')
  const cmd = commandOf(d, first.id)
  assert.equal(cmd.text, 'H 9')
  assert.equal(commandOf(d, null), null)
  const [line, col] = posOf(TRACK, 'H 9')
  assert.equal(highlightLabel({ file: 'main.tsx', line, col, seg: 'H 9' }), `main.tsx:${line}:${col}`)
  assert.equal(highlightLabel({ file: 'main.tsx', line }), `main.tsx:${line}`)
  // without a literal position the track stays one item per command, but with the call's range
  const plain = compileBoard(h(PCB, { name: 'S' }, edge(), route({ net: 'A', layer: 'F.Cu', width: 0.3, d: 'M 2 2 H 9 V 6' })))
  assert.equal(plain.items.filter(i => i.kind === 'track').length, 2)
  assert.equal(commandOf(site(plain), plain.items.find(i => i.kind === 'track').id), null)
})
