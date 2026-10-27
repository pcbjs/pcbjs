// The route chain route(a).H(…).via(…).X(b), vias as route ends, `.net` on pin and pad handles, and iterables as children.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, NC, route, via, SchematicError } from '@pcbjs/core'
import { R0603, PinHeader, SOT23, USBC } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'

const edge = (w = 30, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const board = (...children) => h(PCB, { name: 'Chain' }, edge(), ...children)
const copper = b => b.items.filter(i => i.kind === 'track' || i.kind === 'via')
  .map(({ id: _i, src: _s, chain: _c, ...rest }) => rest)

test('.net: a pin gives its net, an NC pin the NC marker, a pad handle the net of its pin', () => {
  const { DP, DN, GND, VBUS, A } = nets()
  const J1 = USBC('full16', 'x').connect({ DP, DN, GND, VBUS, CC1: NC, CC2: NC, SBU1: NC, SBU2: NC, SHIELD: GND })
  assert.equal(J1.DP.net, DP)
  assert.equal(J1.B6.net, DP)
  assert.equal(J1['A7'].net, DN)
  assert.equal(J1.pad('B7').net, DN)
  assert.equal(J1.SBU1.net, NC)
  const H1 = PinHeader(2).connect(A, GND)
  assert.equal(H1[1].net, A)
  assert.equal(Object.keys(H1[1]).includes('net'), false, 'not enumerable, so a spread handle stays as it was')
})

test('.net: a part not connected yet and an unconnected pin throw a SchematicError naming the part and the pin', () => {
  const { A } = nets()
  const H1 = PinHeader(3)
  const early = H1[2]
  assert.throws(() => early.net, e => e instanceof SchematicError && /PinHeader.*\.2\.net: .* is not connected yet/.test(e.message))
  H1.connect({ 1: A })
  assert.throws(() => H1[2].net, e => e instanceof SchematicError && /pin 2 of .* is unconnected/.test(e.message))
  assert.throws(() => early.net, /unconnected/, 'a handle taken before connect answers after it')
  assert.equal(H1[1].net, A)
})

test('via: the handle form takes the net of the pin or pad, the net and object forms stay', () => {
  const { A, GND } = nets()
  const R1 = R0603('1k').connect(A, GND)
  assert.equal(via(R1[1], '5 5').props.net, A)
  assert.equal(via(GND, '5 5', { drill: 0.3 }).props.drill, 0.3)
  assert.equal(via({ net: 'GND', at: '1 1' }).props.at, '1 1')
  const H1 = PinHeader(2).connect(A, NC)
  assert.throws(() => via(H1[2], '1 1'), /connected to NC/)
})

/** R1 at (5, 5) and R2 at (20, 10), both on A and GND. */
function pair() {
  const { A, GND } = nets()
  return { A, R1: R0603('1k').connect(A, GND), R2: R0603('1k').connect(A, GND) }
}

test('via as a route end: route(pad).Z(via) ends at it, route(via).X(pad) starts from it on any of its layers', () => {
  const { R1, R2 } = pair()
  const v = via(R1[1], '10 5')
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), v,
    route(R1[1]).Z(v).width(0.2), route(v).layer('B.Cu').Z('20 5').width(0.2)))
  const tracks = b.items.filter(i => i.kind === 'track')
  assert.deepEqual(tracks[0].pts.at(-1), [10, 5])
  assert.equal(tracks[0].layer, 'F.Cu')
  assert.deepEqual(tracks[1].pts, [[10, 5], [20, 5]])
  assert.equal(tracks[1].layer, 'B.Cu', 'a through via is met on B.Cu without a via of its own')
  assert.ok(tracks.every(t => t.net === 'A'), 'the net of the via, where no pad gives one')
  assert.equal(b.items.filter(i => i.kind === 'via').length, 1)
})

test('via as a route end inside a group: its position is read in the group frame', () => {
  const { R1, R2 } = pair()
  const v = via(R1[1], '5 0')
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }),
    h('g', { at: '5 5' }, v, route(R1[1]).Z(v).width(0.2))))
  const vi = b.items.find(i => i.kind === 'via')
  assert.deepEqual(vi.at, [10, 5])
  assert.deepEqual(b.items.find(i => i.kind === 'track').pts.at(-1), [10, 5])
})

test('the chain makes the same copper as the route path string, for the demo Blinky routes', () => {
  const make = chain => {
    const { GND, SIG, SW } = nets()
    const J1 = PinHeader(3).connect(GND, SIG, SIG)
    const Q1 = SOT23(3)('MMBT3904').connect(SIG, GND, SW)
    return compileBoard(h(PCB, { name: 'Blinky', autoroute: { bend: '45', viaCost: 4 } }, edge(), h(J1, { at: '3 7.46' }), h(Q1, { at: '26 10' }),
      chain ? route(J1[3]).V(14).L(5, 16).via('B.Cu').H(24).V(7.5).via('F.Cu').X(Q1[1]).width(0.25)
        : route(J1[3], Q1[1], 'V 14 L 5 16 @B.Cu H 24 V 7.5 @F.Cu XZ').width(0.25),
      chain ? route(Q1[2]).X('25 12.5 B.Cu').width(0.3) : route(Q1[2], '25 12.5 B.Cu').width(0.3)))
  }
  const s = make(false), c = make(true)
  assert.ok(copper(s).length > 6)
  assert.deepEqual(copper(c), copper(s))
})

test('the chain: units, relative commands, waypoints and a pair', () => {
  const { R1, R2 } = pair()
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }),
    route(R1[1]).h('1mm').v('-50mil').Z('10 3').L(12, 3).Z(R2[1]).width(0.2)))
  const pts = b.items.filter(i => i.kind === 'track').map(t => t.pts.at(-1).map(n => Math.round(n * 1000) / 1000))
  assert.deepEqual(pts.slice(0, 4), [[5.175, 5], [5.175, 3.73], [10, 3], [12, 3]])
  const r = route([R1[1], R2[1]]).via('B.Cu').X([R1[2], R2[2]]).impedance(90)
  assert.equal(r.props.pair, true)
  assert.throws(() => compileBoard(board(h(R1, { at: '5 5' }), route([R1[1], R2[1]]).X(R1[2]))), /starts a differential pair/)
})

test('the chain: no end is a compile error at the call, mixing with a path string or after compile is a TypeError', () => {
  const { R1 } = pair()
  assert.throws(() => compileBoard(board(h(R1, { at: '5 5' }), route(R1[1]).h(3))), e => e instanceof CompileError && /has no end: finish its chain with \.Z\(target\)/.test(e.message))
  assert.throws(() => route(R1[1], R1[2], 'Z').h(3), e => e instanceof TypeError && /as a string or as a chain, not both/.test(e.message))
  assert.throws(() => route(R1[1], R1[2]).h(3), e => e instanceof TypeError && /has its end already/.test(e.message))
  const r = route(R1[1]).Z('10 5')
  compileBoard(board(h(R1, { at: '5 5' }), r))
  assert.throws(() => r.h(1), /compiled already/)
  assert.throws(() => compileBoard(board(h(R1, { at: '5 5' }), route(R1[1]).Z(R1[2]).Z('10 5'))), /a pin, a pad or a pair is only the end/)
})

test('iterables as children: a generator compiles like an array, every time, and a bad yield names its position', () => {
  const { R1, R2 } = pair()
  function* parts() { yield h(R1, { at: '5 5' }); yield [h(R2, { at: '20 10' })]; yield new Set([route(R1[1]).X(R2[1]).width(0.2)]) }
  const tree = board(parts())
  const a = compileBoard(tree), b = compileBoard(tree)
  assert.equal(a.footprints.length, 2)
  assert.deepEqual(copper(b), copper(a), 'the generator was read once and kept')
  function* bad() { yield h(R1, { at: '5 5' }); yield { at: '1 1' } }
  assert.throws(() => compileBoard(board(bad())), e => e instanceof CompileError && /unexpected child \{"at":"1 1"\}, yield 2 of an iterable child/.test(e.message))
})

test('types: the chain, .net and the via end type check, and tsc rejects a bad chain', async () => {
  const ts = (await import('typescript')).default
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const core = new URL(import.meta.resolve('@pcbjs/core')).pathname
  const lib = new URL(import.meta.resolve('@pcbjs/lib')).pathname
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-chain-'))
  const lines = [
    `import { nets, route, via, type Net, type RouteBuilder, type ViaNode, type PcbNode } from ${JSON.stringify(core)}`,
    `import { USBC, SOIC } from ${JSON.stringify(lib)}`,
    `const { DP, DN } = nets()`,
    `const J1 = USBC('full16', 'x').connect({ DP, DN })`,
    `const U1 = SOIC(8)('x')`,
    `const SMALL = { drill: 0.2, size: 0.45 }`,
    `export const n: Net = J1.B6.net`,
    `export const v: ViaNode = via(J1.B6.net, '11.25 6.2', SMALL)`,
    `export const w: ViaNode = via(J1.A6, '12.25 6.2')`,
    `export const r: RouteBuilder = route(J1.B6).h(1.0).v('10mil').X('100mil 200mil').via('In1.Cu').Z(v).width(0.2).lock()`,
    `export const p: RouteBuilder = route([J1.DP, J1.DN]).via('B.Cu').X([U1[1], U1[2]]).impedance(90).gap(0.15)`,
    `export const g: Iterable<PcbNode> = (function* () { yield v; yield route(v).X(U1[3]) })()`,
    `// @ts-expect-error H takes one length`,
    `export const bad1 = route(J1.B6).H(1, 2)`,
    `// @ts-expect-error via takes a layer name`,
    `export const bad2 = route(J1.B6).via(2)`,
    `// @ts-expect-error a net is not a route end`,
    `export const bad3 = route(J1.B6).Z(DP)`,
  ]
  const file = join(dir, 'fixture.ts')
  writeFileSync(file, lines.join('\n') + '\n')
  try {
    const program = ts.createProgram([file], { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, types: [] })
    const diags = ts.getPreEmitDiagnostics(program).filter(d => d.file?.fileName === file)
    assert.deepEqual(diags.map(d => `${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('chain tuples: a tuple of two numbers, or two numbers and a layer, is one position as an end and as a waypoint', () => {
  for (const t of [[25, 15], [25, 15, 'F.Cu'], ['25mm', 15]]) {
    const { A, B } = nets()
    const R1 = R0603('1k').connect(A, B)
    const b = compileBoard(board(h(R1, { at: '5 5' }), route(R1[1]).Z(t).width(0.3)))
    const tr = b.items.filter(i => i.kind === 'track')
    assert.equal(tr.length, 1, JSON.stringify(t))
    assert.deepEqual(tr[0].pts.at(-1), [25, 15])
  }
  const { C, D } = nets()
  const R2 = R0603('1k').connect(C, D)
  const b = compileBoard(board(h(R2, { at: '5 5' }), route(R2[1]).Z([10, 10]).Z([20, 10]).width(0.3)))
  assert.deepEqual(b.items.filter(i => i.kind === 'track').flatMap(t => t.pts).at(-1), [20, 10])
})

test('chain tuples: a pair end is two handles or two positions, and a tuple waypoint in a pair chain is a position', () => {
  const { P, N } = nets()
  const Ra = R0603('1k').connect(P, N)
  const Rb = R0603('1k').connect(P, N)
  // a tuple waypoint between the two pair ends, and two coordinate tuples as the pair end
  const b = compileBoard(board(h(Ra, { at: '5 10 90' }), h(Rb, { at: '25 10 90' }),
    route([Ra[1], Ra[2]]).Z([12, 10]).Z([Rb[1], Rb[2]]).width(0.2).gap(0.3)))
  assert.equal(b.items.filter(i => i.kind === 'track').length > 0, true)
  assert.throws(() => compileBoard(board(h(Ra, { at: '5 10 90' }), h(Rb, { at: '25 10 90' }), route([Ra[1], Ra[2]]).X([12, 10, 'B.Cu']).Z([Rb[1], Rb[2]]))),
    e => e instanceof CompileError && /waypoint \[12,10,"B.Cu"\] names a layer; .* write it as \[12, 10\] and change layer with \.via\('B.Cu'\)/.test(e.message))
  const { Q } = nets()
  const R3 = R0603('1k').connect(Q, Q)
  assert.throws(() => compileBoard(board(h(R3, { at: '5 5' }), route(R3[1]).Z([R3[1], R3[2]]))), /ends at a pair \[P, N\] but starts at a single end/)
})
