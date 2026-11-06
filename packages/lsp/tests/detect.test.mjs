// The detector against fixtures that mirror the demo: every kind, exact ranges, partial code; the value models and the summaries.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detect, hitAt, encodeValue } from '../dist/detect.js'

import { parse } from '../dist/doc.js'

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

test('main.tsx: at, side, layer, size, width, via at, chain commands, chained width and route ends', () => {
  const text = fixture('main.tsx')
  const hits = detect(parse(text, 'main.tsx'))
  for (const h of hits) assert.equal(text.slice(h.start, h.end), h.value, `range of ${h.kind} ${h.value}`)
  const kinds = k => hits.filter(h => h.kind === k).map(h => h.value)
  assert.deepEqual(kinds('at'), ['3 7.46', '26 10', '0 5', '0 10', '0 15', '15 10', '15 8.3', '15.8 11.6', '3 4.3', '15 18.5'])
  assert.deepEqual(kinds('side'), ['B'])
  assert.deepEqual(kinds('layer'), ['Edge.Cuts', 'B.SilkS', 'B.Cu', 'B.Cu', 'F.SilkS', 'F.SilkS'])
  assert.deepEqual(kinds('size'), ['0.8', '0.8', '1'])
  assert.deepEqual(kinds('width'), ['0.3', '0.3', '0.3', '0.3', '0.3', '0.25', '0.3'])
  assert.deepEqual(kinds('svgPath'), [])
  assert.deepEqual(kinds('point'), ['3 10', '9 5', '9 11.6', '15.8 11.6', '22.2 5', '25 12.5 B.Cu'])
  assert.deepEqual(kinds('chainCommand').slice(-7), ['V(14)', 'L(5, 16)', "via('B.Cu')", 'H(24)', 'V(7.5)', "via('F.Cu')", 'X()'])

  const j1 = find(text, hits, '3 7.46')
  assert.deepEqual(j1.context, { prop: 'at', owner: 'J1', quote: '"' })
  const leg = find(text, hits, 'X()')
  assert.equal(leg.kind, 'chainCommand')
  assert.deepEqual(leg.context.args, [])
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
  // pad references in route ends
  assert.deepEqual(
    hits.filter(h => h.kind === 'pinRef').map(h => `${h.context.ref}[${h.value}] ${h.context.prop}`),
    ['J1[3] a', 'Q1[1] b', 'Q1[2] a'],
  )
})

test('partial code: unterminated strings, unclosed calls and tags are tolerated', () => {
  const text = [
    "import PCB, { route } from '@pcbjs/core'",
    'export default (',
    '  <PCB name="P">',
    '    <J1 at="3 7.46" />',
    "    {route(J1[3], Q1[1]).V(14).via('B.Cu').width(",
    '    <text layer="F.SilkS" at="15',
    '    <C1 at="1 2" side="B"',
    "    {route(A, '3 4",
  ].join('\n')
  const hits = detect(parse(text, 'partial.tsx'))
  for (const h of hits) assert.equal(text.slice(h.start, h.end), h.value)
  const values = hits.map(h => `${h.kind}:${h.value}`)
  assert.ok(values.includes('at:3 7.46'))
  assert.ok(values.includes('chainCommand:V(14)'))
  assert.ok(!values.some(v => v.startsWith('at:15')), 'the unterminated at is skipped')
  assert.ok(!values.some(v => v.includes('3 4')), 'the unterminated end is skipped')
  // Empty and garbage input never throw.
  assert.deepEqual(detect(parse('', 'e.tsx')), [])
  assert.doesNotThrow(() => detect(parse('<<<{{{ route( ( ( "', 'g.tsx')))
  // A .ts file without JSX still finds route calls.
  const ts = detect(parse("import { route } from '@pcbjs/core'\nexport const r = route('1 2', '3 4 B.Cu', '5 6').width(0.4).X('2 2')\n", 'r.ts'))
  assert.deepEqual(
    ts.map(h => `${h.kind}:${h.context.prop}`),
    ['point:a', 'point:b', 'point:end3', 'width:width', 'chainCommand:X', 'point:waypoint'],
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
