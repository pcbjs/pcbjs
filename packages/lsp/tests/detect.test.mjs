// The detector against fixtures that mirror the demo: every kind, exact ranges, partial code; the value models and the summaries.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detect, hitAt, encodeValue, routeCalls } from '../dist/detect.js'
import { summary } from '../dist/describe.js'
import * as V from '../dist/values.js'

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** The hit for the n-th occurrence of `needle` in the text, where the hit's range is exactly the needle. */
function find(text, hits, needle, n = 0) {
  let at = -1
  for (let k = 0; k <= n; k++) at = text.indexOf(needle, at + 1)
  assert.ok(at >= 0, `${needle} is in the fixture`)
  const hit = hits.find(h => h.start === at && h.end === at + needle.length)
  assert.ok(hit, `a hit spans exactly ${JSON.stringify(needle)} #${n}`)
  assert.equal(text.slice(hit.start, hit.end), hit.value)
  return hit
}

test('main.tsx: at, side, layer, size, width, svg d, via at, route path, chained width and a route end', () => {
  const text = fixture('main.tsx')
  const hits = detect(text, 'main.tsx')
  for (const h of hits) assert.equal(text.slice(h.start, h.end), h.value, `range of ${h.kind} ${h.value}`)
  const kinds = k => hits.filter(h => h.kind === k).map(h => h.value)
  assert.deepEqual(kinds('at'), ['3 7.46', '26 10', '0 5', '0 10', '0 15', '15 10', '15 8.3', '15.8 11.6', '3 4.3', '15 18.5'])
  assert.deepEqual(kinds('side'), ['B'])
  assert.deepEqual(kinds('layer'), ['Edge.Cuts', 'B.SilkS', 'B.Cu', 'B.Cu', 'F.SilkS', 'F.SilkS'])
  assert.deepEqual(kinds('size'), ['0.8', '0.8', '1'])
  assert.deepEqual(kinds('width'), ['0.3', '0.3', '0.3', '0.25', '0.3'])
  assert.deepEqual(kinds('svgPath'), ['M 3 10 H 9 M 9 5 V 15 M 9 11.6 H 15.8', 'M 15.8 11.6 V 10', 'M 22.2 5 V 16.5 H 27 V 10'])
  assert.deepEqual(kinds('routePath'), ['V 14 L 5 16 @B.Cu H 24 V 7.5 @F.Cu XZ'])
  assert.deepEqual(kinds('point'), ['25 12.5 B.Cu'])

  const j1 = find(text, hits, '3 7.46')
  assert.deepEqual(j1.context, { prop: 'at', owner: 'J1', quote: '"' })
  const sig = find(text, hits, 'V 14 L 5 16 @B.Cu H 24 V 7.5 @F.Cu XZ')
  assert.deepEqual(sig.context, { prop: 'path', owner: 'route', quote: "'" })
  const chained = find(text, hits, '0.25')
  assert.equal(chained.kind, 'width')
  assert.equal(chained.context.chain, true)
  assert.equal(find(text, hits, '25 12.5 B.Cu').context.prop, 'b')
  assert.equal(find(text, hits, 'Edge.Cuts').context.owner, 'path')
  // The outline is a template with substitutions: not a literal, not a hit.
  assert.ok(!hits.some(h => h.value.includes('${')))
  // hitAt: inside, at both ends, and nothing between literals.
  assert.equal(hitAt(hits, j1.start), j1)
  assert.equal(hitAt(hits, j1.end), j1)
  assert.equal(hitAt(hits, j1.start + 2), j1)
  assert.equal(hitAt(hits, text.indexOf('<J1')), undefined)
  // pad references in route ends, the copper count and the rotation nested in a position
  assert.deepEqual(
    hits.filter(h => h.kind === 'pinRef').map(h => `${h.context.ref}[${h.value}] ${h.context.prop}`),
    ['J1[3] a', 'Q1[1] b', 'Q1[2] a'],
  )
  assert.deepEqual(kinds('copper'), ['2'])
})

test('route calls: the call, its builder chain, and whether the code gives a width', () => {
  const text = fixture('main.tsx')
  const calls = routeCalls(text, 'main.tsx')
  assert.deepEqual(
    calls.map(c => [text.slice(c.start, c.start + 9), c.hasWidth]),
    [
      ['route(VCC', true],
      ['route(VCC', true],
      ['route(SW,', true],
      ['route(J1[', true],
      ['route(Q1[', true],
    ],
  )
  const sig = calls[3]
  assert.ok(text.slice(sig.end, sig.chainEnd) === '.width(0.25)')
  assert.deepEqual(
    routeCalls("route(a, b, 'XZ').layer('B.Cu')", 'x.ts').map(c => c.hasWidth),
    [false],
  )
})

test('layout files: unit suffixes, rotations and negative coordinates', () => {
  const text = fixture('led-channel.layout.tsx')
  const hits = detect(text, 'led-channel.layout.tsx')
  assert.deepEqual(
    hits.filter(h => h.kind === 'at').map(h => h.value),
    ['12mm 0', '20mm 0 180deg', '16mm -1.4mm'],
  )
  assert.equal(find(text, hits, '20mm 0 180deg').context.owner, 'g.D')
  assert.equal(hits.filter(h => h.kind === 'svgPath').length, 3)
  const stack = fixture('led-channel-stack.layout.tsx')
  const sh = detect(stack, 'led-channel-stack.layout.tsx')
  assert.deepEqual(
    sh.map(h => [h.kind, h.value]),
    [
      ['at', '0 0 90deg'],
      ['rotation', '90deg'],
      ['at', '0 4 90deg'],
      ['rotation', '90deg'],
      ['pinRef', '2'],
      ['width', '0.3'],
    ],
  )
  // a pad of a member of a group or an instance is a pad reference too, its part named as written
  assert.deepEqual(
    sh.filter(h => h.kind === 'pinRef').map(h => [h.context.ref, h.context.form]),
    [['g.R', 'index']],
  )
  const part = fixture('MyPart.tsx')
  const ph = detect(part, 'MyPart.tsx')
  assert.deepEqual(
    ph.filter(h => h.kind === 'at').map(h => h.value),
    ['-1.0mm -0.95mm', '-1.0mm 0.95mm', '1.0mm 0'],
  )
  assert.deepEqual(
    ph.filter(h => h.kind === 'size').map(h => [h.value, h.context.index]),
    [
      ['0.9', 0],
      ['0.8', 1],
      ['0.9', 0],
      ['0.8', 1],
      ['0.9', 0],
      ['0.8', 1],
    ],
  )
  assert.deepEqual(
    ph.filter(h => h.kind === 'width').map(h => h.value),
    ['0.05', '0.2'],
  )
  assert.deepEqual(
    ph.filter(h => h.kind === 'svgPath').map(h => h.value),
    ['M -0.9 -1.6 H 0.9 M -0.9 1.6 H 0.9'],
  )
})

test('extras: object forms of route, via and pour, arrays, negatives, units, templates and builder chains', () => {
  const text = fixture('extras.tsx')
  const hits = detect(text, 'extras.tsx')
  for (const h of hits) assert.equal(text.slice(h.start, h.end), h.value)
  const pick = k => hits.filter(h => h.kind === k).map(h => `${h.context.owner}.${h.context.prop}${h.context.chain ? '()' : ''}=${h.value}`)
  assert.deepEqual(pick('thickness'), ['PCB.thickness=1.6', 'text.thickness=0.2mm'])
  assert.deepEqual(pick('drill'), ['pad.drill=0.4', 'via.drill=0.3', 'via.drill=0.3'])
  assert.deepEqual(pick('size'), ['pad.size=0.9', 'pad.size=0.8', 'text.size=-1.5', 'via.size=0.6', 'via.size=0.6'])
  assert.deepEqual(pick('layer'), [
    'track.layer=F.Cu',
    'zone.layer=B.Cu',
    'pad.layers=F.Cu',
    'pad.layers=B.Cu',
    'text.layer=silk',
    'via.layers=F.Cu',
    'via.layers=In1.Cu',
    'zone.layer=B.Cu',
    'track.layer=F.Cu',
    'route.layer()=B.Cu',
  ])
  assert.deepEqual(pick('svgPath'), ['track.d=M 1 1 H 5', 'zone.d=M 0 0 H 30 V 20 H 0 Z', 'zone.d=M 0 0 H 30 V 20 H 0 Z', 'track.d=M 3 10 H 9'])
  assert.deepEqual(pick('routePath'), ['route.path=X 4 4 XZ'])
  assert.deepEqual(pick('point'), ['route.a=5 16 B.Cu'])
  assert.deepEqual(pick('side'), ['g.side=bottom'])
  assert.deepEqual(pick('at'), ['pad.at=-1.0mm 0.95mm', 'text.at=2 3 90deg', 'g.at=0 5', 'via.at=15.8 11.6', 'via.at=1 2'])
  assert.deepEqual(pick('width'), ['track.width=0.5', 'track.width=0.3', 'route.width()=0.2'])
  // The negative size includes its minus sign; the template path keeps its backticks outside the range.
  const neg = find(text, hits, '-1.5')
  assert.equal(neg.context.quote, 'number')
  assert.equal(find(text, hits, 'X 4 4 XZ').context.quote, '`')
  // A pad name as a route end is not a coordinate but a pad reference.
  assert.deepEqual(
    hits.filter(h => h.value === 'D1.K').map(h => [h.kind, h.context.ref, h.context.form]),
    [['pinRef', 'D1', 'dotted']],
  )
})

test('partial code: unterminated strings, unclosed calls and tags are tolerated', () => {
  const text = [
    "import PCB, { route } from '@pcbjs/core'",
    'export default (',
    '  <PCB name="P">',
    '    <J1 at="3 7.46" />',
    "    {route(J1[3], Q1[1], 'V 14 @B.Cu XZ').width(",
    '    <text layer="F.SilkS" at="15',
    '    <C1 at="1 2" side="B"',
    "    {route(A, B, 'H 3 Z",
  ].join('\n')
  const hits = detect(text, 'partial.tsx')
  for (const h of hits) assert.equal(text.slice(h.start, h.end), h.value)
  const values = hits.map(h => `${h.kind}:${h.value}`)
  assert.ok(values.includes('at:3 7.46'))
  assert.ok(values.includes('routePath:V 14 @B.Cu XZ'))
  assert.ok(!values.some(v => v.startsWith('at:15')), 'the unterminated at is skipped')
  assert.ok(!values.some(v => v.includes('H 3 Z')), 'the unterminated path is skipped')
  // Empty and garbage input never throw.
  assert.deepEqual(detect('', 'e.tsx'), [])
  assert.doesNotThrow(() => detect('<<<{{{ route( ( ( "', 'g.tsx'))
  // A .ts file without JSX still finds route calls.
  const ts = detect("import { route } from '@pcbjs/core'\nexport const r = route('1 2', '3 4 B.Cu', 'X 2 2 XZ').width(0.4)\n", 'r.ts')
  assert.deepEqual(
    ts.map(h => h.kind),
    ['point', 'point', 'routePath', 'width'],
  )
})

test('encodeValue keeps literals well formed', () => {
  const hit = quote => ({ kind: 'at', start: 0, end: 0, value: '', context: { prop: 'at', owner: 'x', quote } })
  assert.deepEqual(encodeValue(hit('"'), '1 2'), { text: '1 2' })
  assert.ok('error' in encodeValue(hit('"'), 'a"b'))
  assert.ok('error' in encodeValue(hit("'"), "a'b"))
  assert.ok('error' in encodeValue(hit('`'), '${x}'))
  assert.ok('error' in encodeValue(hit('"'), 'a\\b'))
  assert.deepEqual(encodeValue(hit('number'), '-0.25'), { text: '-0.25' })
  assert.ok('error' in encodeValue(hit('number'), '0.25mm'))
})

test('values: at keeps units and separators, nudges, rotates; points, sides, layers and ranges', () => {
  const a = V.parseAt('20mm 0 180deg')
  assert.equal(V.formatAt(V.nudgeAt(a, 0.1, -0.5)), '20.1mm -0.5 180deg')
  assert.equal(V.formatAt(V.rotateAt(a, 90)), '20mm 0 270deg')
  assert.equal(V.formatAt(V.rotateAt(V.rotateAt(a, 90), 90)), '20mm 0 0deg')
  assert.equal(V.formatAt(V.rotateAt(V.parseAt('3 7.46'), 90)), '3 7.46 90')
  assert.equal(V.formatAt(V.rotateAt(V.parseAt('1mm, 2mm'), -90)), '1mm, 2mm, 270deg')
  assert.equal(V.formatAt(V.nudgeAt(V.parseAt('100mil 0.1in'), 0.0254, 2.54)), '101mil 0.2in')
  assert.equal(V.formatAt(V.rotateAt(V.parseAt('0 0 0.25turn'), 90)), '0 0 0.5turn')
  assert.equal(V.formatAt(V.setAtField(a, 'x', '3')), '3mm 0 180deg')
  assert.equal(V.formatAt(V.setAtField(a, 'y', '2mil')), '20mm 2mil 180deg')
  assert.equal(V.setAtField(a, 'x', 'abc'), undefined)
  assert.equal(V.parseAt('1'), undefined)
  assert.equal(V.parseAt('1 2 3 4'), undefined)
  const p = V.parsePoint('25 12.5 B.Cu')
  assert.equal(V.formatPoint({ ...V.nudgeAt(p, 1, 0), layer: 'F.Cu' }), '26 12.5 F.Cu')
  assert.ok(V.isCoordinate('5 16 B.Cu'))
  assert.ok(!V.isCoordinate('D1.K'))
  assert.deepEqual(['B', 'F', 'b', 'top', 'Bottom', 'FRONT', 'back', 'x'].map(V.toggleSide), ['F', 'B', 'f', 'bottom', 'Top', 'BACK', 'front', undefined])
  assert.equal(V.canonicalLayer('bottom'), 'B.Cu')
  assert.equal(V.canonicalLayer('F.Courtyard'), 'F.CrtYd')
  assert.deepEqual(
    V.layerChoices(undefined, true).map(l => l.name),
    ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu', 'B.Cu'],
  )
  assert.deepEqual(
    V.layerChoices(['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu', 'F.SilkS'], true).map(l => l.name),
    ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'],
  )
  assert.equal(V.layerChoices(undefined, false).length, 21)
  assert.deepEqual(V.numericRange('width', 'route'), { min: 0.1, max: 2, step: 0.05 })
  assert.deepEqual(V.numericRange('size', 'text'), { min: 0.5, max: 5, step: 0.05 })
  assert.deepEqual(V.numericRange('drill', 'via'), { min: 0.2, max: 3, step: 0.05 })
  assert.deepEqual(V.numericRange('width', 'track', 3.2), { min: 0.1, max: 3.2, step: 0.05 })
})

test('summary describes each kind for the hover', () => {
  const hits = detect(fixture('main.tsx'), 'main.tsx')
  const s = v => summary(hits.find(h => h.value === v))
  assert.equal(s('3 7.46'), 'x 3 mm, y 7.46 mm')
  assert.equal(s('V 14 L 5 16 @B.Cu H 24 V 7.5 @F.Cu XZ'), '7 commands, 2 vias, autorouted to b')
  assert.equal(s('25 12.5 B.Cu'), 'x 25 mm, y 12.5 mm on B.Cu')
  assert.equal(s('B'), 'back side, mirrored')
  assert.equal(s('0.25'), 'width 0.25 mm')
})
