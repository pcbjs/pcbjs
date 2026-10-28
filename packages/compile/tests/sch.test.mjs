// The schematic picture: symbols placed by hand and on a grid, the square router, labels, junctions and every sch-* finding.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, group, defineFootprint, defineSymbol, resetDefaults, Schematic, Sheet, Sym, Label, Power, wire } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { squareRoute } from '../dist/sch-route.js'

afterEach(() => resetDefaults())

const pad = (num, x) => h('pad', { num, at: [x, 0], size: [0.8, 0.8] })
const Two = prefix => defineFootprint(p => h('footprint', p, pad(1, -1), pad(2, 1)), { pins: ['1', '2'], prefix })
const R = Two('R'),
  C = Two('C')
const Chip = defineFootprint(
  p => h('footprint', p, ...['VDD', 'IN', 'EN', 'OUT', 'FB', 'GND'].map((n, i) => h('pad', { num: i + 1, name: n, at: [i * 1.3, 0], size: [0.8, 0.8] }))),
  { pins: ['VDD', 'IN', 'EN', 'OUT', 'FB', 'GND'], prefix: 'U' },
)
const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 20 })
const board = (sch, ...parts) =>
  compileBoard(h(PCB, { name: 'S', silkRefs: false, ...(sch ? { schematic: sch } : {}) }, edge(), ...parts.map((p, i) => h(p, { at: [3 + i * 4, 5] }))), { routeCache: false })
const sch = b => b.schematic.drawing
const findings = (b, rule) => b.erc.filter(d => d.rule === rule)
const square = w => w.pts.every((p, i) => i === 0 || p[0] === w.pts[i - 1][0] || p[1] === w.pts[i - 1][1])

test('a board without <Schematic> gets every part placed on the grid, wired square, no findings', () => {
  const { A, B, GND } = nets()
  const R1 = R('1k').connect(A, B),
    R2 = R('2k').connect(B, GND),
    U1 = Chip('X').connect({ VDD: A, IN: B, EN: A, OUT: B, FB: B, GND })
  const b = board(null, R1, R2, U1)
  const d = sch(b)
  assert.equal(d.symbols.length, 3)
  assert.deepEqual(d.symbols.map(s => s.kind).sort(), ['box', 'resistor', 'resistor'])
  assert.ok(d.symbols.every(s => s.auto))
  for (const s of d.symbols) for (const p of s.pins) assert.ok(Number.isInteger(Math.round((p.end[0] / d.grid) * 1e6) / 1e6), 'pin ends on the grid')
  assert.ok(d.wires.length > 0 && d.wires.every(square), 'only horizontal and vertical segments')
  assert.ok(
    d.labels.some(l => l.net === 'GND' && l.kind === 'gnd'),
    'GND gets power symbols',
  )
  assert.deepEqual(
    b.erc.filter(x => x.rule.startsWith('sch-')),
    [],
  )
  const box = d.symbols.find(s => s.kind === 'box')
  const side = n => box.pins.find(p => p.name === n).side
  assert.equal(side('VDD'), 'top')
  assert.equal(side('GND'), 'bottom')
  assert.equal(side('OUT'), 'right')
  assert.equal(side('IN'), 'left')
})

test('<Sym> places, turns and mirrors a symbol; pin ends follow', () => {
  const { A, B } = nets()
  const R1 = R('1k').connect(A, B)
  const d = sch(board(h(Schematic, {}, h(Sym, { part: R1, at: '10 6', rot: 90 })), R1))
  const s = d.symbols[0]
  assert.equal(s.auto, false)
  const g = d.grid,
    end = n => s.pins.find(p => p.name === n).end.map(v => Math.round(v / g))
  // pin 1 is left of the body at rot 0; a quarter turn counterclockwise takes it below
  assert.deepEqual(end('1'), [10, 8])
  assert.deepEqual(end('2'), [10, 4])
  const R2 = R('1k').connect(A, B)
  const f = sch(board(h(Schematic, {}, h(Sym, { part: R2, at: '10 6', flip: true })), R2)).symbols[0]
  assert.deepEqual(
    f.pins.find(p => p.name === '1').end.map(v => Math.round(v / g)),
    [12, 6],
  )
})

test('a part element inside <Schematic> and <Sheet> is its symbol, as <Sym> places it', () => {
  const { A, B } = nets()
  const one = defineSymbol({ pins: { 1: { side: 'left', at: 1 }, 2: { side: 'right', at: 1 } } })
  const R1 = R('1k').connect(A, B),
    R2 = R('2k').connect(A, B),
    P = group('P', { R: R('3k').connect(A, B) })
  const d = sch(
    board(h(Schematic, {}, h(R1, { at: '10 6', rot: 90 }), h(R2, { at: '20 6', flip: true, symbol: one }), h(Sheet, { group: P, at: '30 4' }, h(P.R, { at: '2 2' }))), R1, R2, P.R),
  )
  const [s1, s2, s3] = ['R1', 'R2', 'R3'].map(r => d.symbols.find(s => s.ref === r))
  assert.deepEqual([s1.auto, s1.rot, s1.at.map(v => v / d.grid)], [false, 90, [10, 6]])
  assert.deepEqual([s2.flip, s2.kind], [true, 'box'])
  assert.deepEqual([s3.auto, s3.at.map(v => v / d.grid)], [false, [32, 6]])
  assert.deepEqual(
    d.sheets.map(x => x.name),
    ['P'],
  )
  assert.deepEqual(
    s1.pins.find(p => p.name === '1').end.map(v => Math.round(v / d.grid)),
    [10, 8],
  )
})

test('a board prop on a part inside <Schematic>, or a symbol prop on the board, is a compile error naming the part', () => {
  const { A, B } = nets()
  const R1 = R('1k').connect(A, B)
  assert.throws(
    () => board(h(Schematic, {}, h(R1, { at: '4 4', side: 'B' })), R1),
    e => /<.*> inside <Schematic> .* side belongs to its placement on the board/.test(e.message),
  )
  resetDefaults()
  const R2 = R('1k').connect(A, B)
  assert.throws(
    () => compileBoard(h(PCB, { name: 'S' }, edge(), h(R2, { at: [5, 5], flip: true })), { routeCache: false }),
    e => /flip belongs to its symbol inside <Schematic>/.test(e.message),
  )
})

test('square routing: a crossing is allowed and counted, a shared run never', () => {
  const cross = squareRoute({
    area: [0, 0, 10, 10],
    blocked: [],
    nets: [
      {
        net: 'A',
        pins: [
          { at: [0, 5], out: 0 },
          { at: [10, 5], out: 2 },
        ],
      },
      {
        net: 'B',
        pins: [
          { at: [5, 0], out: 1 },
          { at: [5, 10], out: 3 },
        ],
      },
    ],
  })
  assert.deepEqual(cross.failed, [])
  assert.equal(cross.crossings, 1)
  assert.deepEqual(cross.wires.get('A'), [
    [
      [0, 5],
      [10, 5],
    ],
  ])
  // one row for two nets whose pins interleave: neither may run along the other, so both fail
  const row = squareRoute({
    area: [0, 0, 10, 0],
    blocked: [],
    nets: [
      {
        net: 'A',
        pins: [
          { at: [0, 0], out: 0 },
          { at: [4, 0], out: 2 },
        ],
      },
      {
        net: 'B',
        pins: [
          { at: [2, 0], out: 0 },
          { at: [8, 0], out: 2 },
        ],
      },
    ],
  })
  assert.deepEqual(row.failed, ['A', 'B'])
  // a crowd of nets: no unit step is used by two nets, and a shared point is a straight crossing
  const crowd = squareRoute({
    area: [0, 0, 12, 12],
    blocked: [
      [6, 6],
      [6, 7],
    ],
    nets: Array.from({ length: 6 }, (_, i) => ({
      net: `N${i}`,
      pins: [
        { at: [0, 1 + 2 * i], out: 0 },
        { at: [12, 11 - 2 * i], out: 2 },
      ],
    })),
  })
  const steps = new Map(),
    points = new Map()
  for (const [net, lines] of crowd.wires)
    for (const l of lines)
      for (let i = 1; i < l.length; i++) {
        const [a, b] = [l[i - 1], l[i]],
          dx = Math.sign(b[0] - a[0]),
          dy = Math.sign(b[1] - a[1])
        for (let p = a; p[0] !== b[0] || p[1] !== b[1];) {
          const q = [p[0] + dx, p[1] + dy],
            k = [p, q].map(String).sort().join('|')
          assert.ok(!steps.has(k) || steps.get(k) === net, `${net} runs along ${steps.get(k)} at ${k}`)
          steps.set(k, net)
          for (const [pt, ax] of [
            [p, dx ? 'h' : 'v'],
            [q, dx ? 'h' : 'v'],
          ]) {
            const m = points.get(String(pt)) ?? new Map()
            m.set(net, new Set([...(m.get(net) ?? []), ax]))
            points.set(String(pt), m)
          }
          p = q
        }
      }
  for (const [pt, m] of points)
    if (m.size > 1) {
      const axes = [...m.values()]
      assert.ok(m.size === 2 && axes.every(a => a.size === 1) && [...axes[0]][0] !== [...axes[1]][0], `${pt} is shared without crossing`)
    }
  assert.ok(crowd.wires.size >= 4)
})

test('a net of more pins than labelOver, and a power net, takes labels instead of wires', () => {
  const { A, B } = nets()
  const parts = [R('1').connect(A, B), R('2').connect(A, B), R('3').connect(A, B)]
  const wired = sch(board(null, ...parts))
  assert.ok(wired.wires.some(w => w.net === 'A'))
  const labelled = sch(board(h(Schematic, { labelOver: 2 }), ...[R('1').connect(A, B), R('2').connect(A, B), R('3').connect(A, B)]))
  assert.ok(!labelled.wires.some(w => w.net === 'A'))
  assert.equal(labelled.labels.filter(l => l.net === 'A').length, 3)
})

test('junction dots where three wire ends of a net meet', () => {
  const { A, B, C: N } = nets()
  const R1 = R('1').connect(A, B),
    R2 = R('2').connect(A, N),
    R3 = R('3').connect(A, N)
  const d = sch(
    board(
      h(Schematic, {}, h(Sym, { part: R1, at: '4 4' }), h(Sym, { part: R2, at: '4 10' }), h(Sym, { part: R3, at: '4 16' }), wire(R1[1]).h(-2).v(12).Z(R3[1]), wire(R2[1]).h(-2)),
      R1,
      R2,
      R3,
    ),
  )
  assert.deepEqual(
    d.junctions.map(j => [j.net, j.at.map(v => Math.round(v / d.grid))]),
    [['A', [0, 10]]],
  )
})

test('sch-short: a hand wire joins pins of two nets', () => {
  const { A, B, X } = nets()
  const R1 = R('1').connect(A, B),
    R2 = R('2').connect(X, B)
  const b = board(h(Schematic, {}, h(Sym, { part: R1, at: '4 4' }), h(Sym, { part: R2, at: '4 8' }), wire(R1[1]).h(-1).v(4).Z(R2[1])), R1, R2)
  const f = findings(b, 'sch-short')
  assert.equal(f.length, 1)
  assert.equal(f[0].severity, 'error')
  assert.match(f[0].message, /A at R\d\.1 and X at R\d\.1/)
  assert.equal(f[0].layer, 'sch')
  assert.ok(f[0].items.length >= 2, 'the pads of both pins')
})

test('sch-missing-symbol: a <Sym> of a part not on the board, a symbol without a pin of its part', () => {
  const { A, B } = nets()
  const R1 = R('1').connect(A, B),
    Rx = R('off').connect(A, B)
  const one = defineSymbol({ pins: { 1: { side: 'left', at: 1 } } })
  const b = board(h(Schematic, {}, h(Sym, { part: Rx, at: '20 20' }), h(Sym, { part: R1, at: '4 4', symbol: one })), R1)
  const msgs = findings(b, 'sch-missing-symbol').map(f => f.message)
  assert.ok(
    msgs.some(m => /not a part on this board/.test(m)),
    msgs.join('\n'),
  )
  assert.ok(
    msgs.some(m => /has no pin 2, on net B/.test(m)),
    msgs.join('\n'),
  )
})

test('sch-unwired: with route={false}, a connected pin with neither a wire nor a label', () => {
  const { A, B } = nets()
  const R1 = R('1').connect(A, B),
    R2 = R('2').connect(A, B)
  const b = board(h(Schematic, { route: false }, h(Label, { net: A, at: '0 0' })), R1, R2)
  const f = findings(b, 'sch-unwired')
  assert.equal(f.length, 4)
  assert.ok(f.every(x => x.items.length === 1))
})

test('sch-dangling: a wire end on nothing, a label on nothing', () => {
  const { A, B } = nets()
  const R1 = R('1').connect(A, B)
  const b = board(h(Schematic, {}, h(Sym, { part: R1, at: '4 4' }), wire(R1[2]).h(3).v(2), h(Power, { net: A, at: '20 20' })), R1)
  const f = findings(b, 'sch-dangling')
  assert.equal(f.length, 2)
  assert.match(f[0].message, /ends at \(9, 6\) on nothing/)
  assert.match(f[1].message, /power symbol A at \(20, 20\) is on no pin or wire/)
})

test('sch-overlap: two symbols on one spot', () => {
  const { A, B } = nets()
  const R1 = R('1').connect(A, B),
    C1 = C('1').connect(A, B)
  const b = board(h(Schematic, {}, h(Sym, { part: R1, at: '4 4' }), h(Sym, { part: C1, at: '4 4' })), R1, C1)
  assert.equal(findings(b, 'sch-overlap').length, 1)
})

test('types: a part element takes its symbol props or its board props, not both', async () => {
  const ts = (await import('typescript')).default
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(import.meta.dirname, '.types-'))
  const lines = [
    `import { defineFootprint, defineSymbol, nets, group } from '@pcbjs/core'`,
    `const Fp = defineFootprint((_p: any) => null, { pins: ['A', 'B'], prefix: 'U' })`,
    `const { X, Y } = nets()`,
    `const U1 = Fp().connect(X, Y), P = group('P', { R: Fp().connect(X, Y) })`,
    `const s = defineSymbol({ pins: { A: { side: 'left', at: 1 }, B: { side: 'right', at: 1 } } })`,
    `export const sym = [<U1 at="4 6" flip />, <U1 at={[4, 6]} rot={90} symbol={s} />, <P.R at="2 2" />]`,
    `export const fp = [<U1 side="B" />, <U1 at="4 6 90" dnp />, <U1 />]`,
    `// @ts-expect-error side is a board prop, flip a symbol prop`,
    `export const bad1 = <U1 at="4 6" side="B" flip />`,
    `// @ts-expect-error rot is a multiple of 90`,
    `export const bad2 = <U1 at="4 6" rot={45} />`,
  ]
  const file = join(dir, 'fixture.tsx')
  writeFileSync(file, lines.join('\n') + '\n')
  try {
    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: '@pcbjs/core',
      skipLibCheck: true,
      types: [],
    })
    const diags = ts.getPreEmitDiagnostics(program).filter(d => d.file?.fileName === file)
    assert.deepEqual(
      diags.map(d => `${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`),
      [],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
