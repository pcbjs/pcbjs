// The assist context: a chain call or an `at` waiting for its argument becomes a context with the command, the start point from the
// chain so far, layer, net, side, grid and relative flag; and the repair rule that cuts such a call so the chain compiles up to it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assistSpot, assistContexts } from '../dist/assist.js'
import { cutCalls, repair } from '../dist/repair.js'
import { docOf, parse } from '../dist/doc.js'

const root = '/p'
const file = '/p/pcb.tsx'
const head = `export default (\n  <PCB grid={G}>\n`
const tail = `\n  </PCB>\n)\n`

/** A site with J1 and R1, one route `route:1` from J1/1 whose `.H(9)` ends at 9 7 and whose `.via('B.Cu')` keeps it there. */
function site(text) {
  const lc = needle => {
    const o = text.indexOf(needle)
    const before = text.slice(0, o).split('\n')
    return { file: 'pcb.tsx', line: before.length, col: before[before.length - 1].length + 1 }
  }
  const steps = []
  for (const m of ['H(9)', "via('B.Cu')"]) if (text.includes(`.${m}`)) steps.push({ op: m.slice(0, m.indexOf('(')), src: lc(m) })
  return {
    name: 'Fix',
    rules: { minTrackWidth: 0.2 },
    sources: { 'pcb.tsx': [] },
    footprints: [
      { ref: 'J1', side: 'F', at: [3, 7], pads: [{ num: '1', name: '1', net: 'VCC', at: [3, 7] }] },
      { ref: 'R1', side: 'B', at: [20, 10], pads: [{ num: '1', name: '1', net: 'VCC', at: [20, 10] }] },
    ],
    schematic: { parts: [], circuits: [] },
    items: [{ id: 1, kind: 'track', layers: ['F.Cu'], route: 'route:1', width: 0.3, rings: [] }],
    grids: [{ name: 'G', pitch: 1.27, minor: [], origin: [0, 0], angle: 0, mirror: false, frame: null, used: [], attach: lc('<PCB') }],
    edit: [
      ...(text.includes('J1[1]') ? [{ ref: 'route:1', caps: ['chain'], src: { chain: lc('route(') }, m: [1, 0, 0, 1, 0, 0], grid: null, steps }] : []),
      { ref: 'R1', caps: ['placed', 'layered'], src: { at: lc('<R1') }, m: [1, 0, 0, 1, 0, 0], grid: 'G', side: 'B', at: [20, 10, 0] },
    ],
    routes: [
      {
        id: 'route:1',
        net: 'VCC',
        length: 6,
        pts: [
          [3, 7],
          [9, 7],
          [9, 7],
        ],
      },
    ],
  }
}

/** The context at the `|` of a source, which is cut out of it. */
function ctx(body) {
  const marked = head + body + tail
  const offset = marked.indexOf('|')
  const text = marked.replace('|', '')
  const spot = assistSpot(parse(text, file), offset)
  if (!spot) return null
  const [c] = assistContexts(spot, docOf(file, text), [{ root, site: site(text) }])
  return { ...c, arg: text.slice(c.start0, c.end0) }
}

test('assist: an empty H after the first end starts on its pad, F.Cu, with the board grid', () => {
  const c = ctx('    {route(J1[1], R1[1]).H(|)}')
  assert.equal(c.command, 'H')
  assert.equal(c.relative, false)
  assert.deepEqual(c.start, [3, 7])
  assert.equal(c.pad, 'J1/1')
  assert.equal(c.layer, 'F.Cu')
  assert.equal(c.side, 'F')
  assert.equal(c.net, 'VCC')
  assert.equal(c.grid, 'G')
  assert.equal(c.ref, 'route:1')
  assert.equal(c.width, 0.3)
  assert.equal(c.open, false)
  assert.equal(c.arg, '')
  assert.equal(c.project, root)
})

test('assist: duplicate board names retain each originating project for a shared source file', () => {
  const text = head + '    {route(J1[1], R1[1]).H()}' + tail
  const spot = assistSpot(parse(text, file), text.indexOf('.H()') + 3)
  const a = site(text),
    b = { ...site(text), sources: { '../pcb.tsx': [] } }
  const contexts = assistContexts(spot, docOf(file, text), [
    { root, site: a },
    { root: `${root}/nested`, site: b },
  ])
  assert.deepEqual(
    contexts.map(c => [c.project, c.board, c.file]),
    [
      [root, 'Fix', file],
      [`${root}/nested`, 'Fix', file],
    ],
  )
})

for (const [cmd, relative] of [
  ['h', true],
  ['V', false],
  ['v', true],
  ['L', false],
  ['l', true],
  ['X', false],
]) {
  test(`assist: .${cmd}( is a context, relative ${relative}`, () => {
    const c = ctx(`    {route(J1[1], R1[1]).${cmd}(|)}`)
    assert.equal(c.command, cmd)
    assert.equal(c.relative, relative)
    assert.deepEqual(c.start, [3, 7])
  })
}

test('assist: after .H(9) the start is where it ends, and a via moves the layer to B.Cu', () => {
  const a = ctx('    {route(J1[1], R1[1]).H(9).V(|)}')
  assert.deepEqual(a.start, [9, 7])
  assert.equal(a.pad, null)
  const b = ctx("    {route(J1[1], R1[1]).H(9).via('B.Cu').v(|)}")
  assert.deepEqual(b.start, [9, 7])
  assert.equal(b.layer, 'B.Cu')
  assert.equal(b.side, 'B')
})

test('assist: an unclosed call is open and its typed number feeds the context', () => {
  const c = ctx('    {route(J1[1], R1[1]).H(9.5|}')
  assert.equal(c.open, true)
  assert.deepEqual(c.typed, [9.5])
  assert.equal(c.arg, '9.5')
})

test('assist: the cursor at the end of a typed argument stays in assist; inside a complete one it does not', () => {
  assert.deepEqual(ctx("    {route(J1[1], R1[1]).L('5mm', |)}").typed, [5])
  assert.equal(ctx('    {route(J1[1], R1[1]).V(1|4)}'), null)
  assert.deepEqual(ctx('    {route(J1[1], R1[1]).V(14|)}').typed, [14])
})

test('assist: a coordinate start with a layer, and a route not compiled yet, resolve from the text', () => {
  const c = ctx("    {route('25 12.5 B.Cu').net(GND).h(|)}")
  assert.deepEqual(c.start, [25, 12.5])
  assert.equal(c.layer, 'B.Cu')
  assert.equal(c.ref, null)
  assert.equal(c.net, 'GND')
})

test('assist: an empty at names its part, side and grid', () => {
  const c = ctx('    <R1 at="|" />')
  assert.equal(c.command, 'at')
  assert.equal(c.ref, 'R1')
  assert.equal(c.side, 'B')
  assert.equal(c.grid, 'G')
  assert.equal(c.start, null)
  assert.equal(ctx('    <R1 at="3| 4" />'), null)
})

test('assist: a call off a route and a finishing .Z() are no spot', () => {
  assert.equal(ctx('    {foo(J1[1]).H(|)}'), null)
  assert.equal(ctx('    {route(J1[1], R1[1]).Z(|)}'), null)
})

test('repair: an empty chain call is cut so the chain compiles up to it', () => {
  const text = `${head}    {route(J1[1], R1[1]).H(9).V()}\n    {route(J1[2], R1[2]).X()}${tail}`
  const c = cutCalls(parse(text, 'pcb.tsx'))
  assert.deepEqual(
    c.spans.map(s => text.slice(s.start, s.end)),
    ['.V()'],
  )
  assert.equal(c.text.length, text.length)
  assert.ok(c.text.includes('{route(J1[1], R1[1]).H(9)    }'))
})

test('repair: an unclosed chain call and its partial argument are cut, the rest of the line kept', () => {
  const text = `${head}    {route(J1[1], R1[1]).H(9.}\n    <R1 at="1 2" />${tail}`
  const r = repair(parse(text, 'pcb.tsx'))
  assert.ok(r.ok, r.text)
  assert.deepEqual(
    r.skipped.map(s => text.slice(s.start, s.end)),
    ['.H(9.'],
  )
  assert.ok(r.text.includes('{route(J1[1], R1[1])     }'))
})

test('assist: divergent variant geometry cannot replace the first target context', () => {
  const text = head + '    {route(J1[1], R1[1]).H()}' + tail
  const spot = assistSpot(parse(text, file), text.indexOf('.H()') + 3)
  const first = { ...site(text), variant: { name: 'First', index: 0, names: ['First', 'Second'] } }
  const second = { ...site(text), variant: { name: 'Second', index: 1, names: ['First', 'Second'] } }
  second.footprints[0].pads[0].at = [90, 80]
  const contexts = assistContexts(spot, docOf(file, text), [
    { root, site: first },
    { root, site: second },
  ])
  assert.equal(contexts.length, 1)
  assert.deepEqual(contexts[0].start, [3, 7])
})
