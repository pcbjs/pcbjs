// The route chain route(a, b).H(…).via(…).X(), vias as route ends, `.net` on pin and pad handles, and iterables as children.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import PCB, { h, nets, NC, route, via, SchematicError, bindRef } from '@pcbjs/core'
import { R0603, PinHeader, SOT23, USBC } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { clearRouteCache } from '@pcbjs/compile/internal/route-cache'
import { fresh, handle } from './parts.mjs'

beforeEach(fresh)

const edge = (w = 30, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const board = (...children) => h(PCB, { name: 'Chain' }, edge(), ...children)
const copper = b => b.items.filter(i => i.kind === 'track' || i.kind === 'via').map(({ id: _i, src: _s, chain: _c, ...rest }) => rest)

test('.net: a pin gives its net, an NC pin the NC marker, a pad handle the net of its pin', () => {
  const { DP, DN, GND, VBUS, A } = nets()
  const J1 = bindRef(USBC('full16')('x').connect({ DP, DN, GND, VBUS, CC1: NC, CC2: NC, SBU1: NC, SBU2: NC, SHIELD: GND }), 'J1')
  assert.equal(J1.DP.net, DP)
  assert.equal(J1.B6.net, DP)
  assert.equal(J1['A7'].net, DN)
  assert.equal(J1['B7'].net, DN)
  assert.equal(J1.SBU1.net, NC)
  const H1 = bindRef(PinHeader(2)().connect({ 1: A, 2: GND }), 'H1')
  assert.equal(H1[1].net, A)
  assert.equal(Object.keys(H1[1]).includes('net'), false, 'not enumerable, so a spread handle stays as it was')
})

test('.net: a part not connected yet and an unconnected pin throw a SchematicError naming the part and the pin', () => {
  const { A } = nets()
  const H1 = bindRef(PinHeader(3)(), 'H1')
  const early = H1[2]
  assert.throws(
    () => early.net,
    e => e instanceof SchematicError && /PinHeader.*\.2\.net: .* is not connected yet/.test(e.message),
  )
  H1.connect({ 1: A })
  assert.throws(
    () => H1[2].net,
    e => e instanceof SchematicError && /pin 2 of .* is unconnected/.test(e.message),
  )
  assert.throws(() => early.net, /unconnected/, 'a handle taken before connect answers after it')
  assert.equal(H1[1].net, A)
})

test('via: the handle form takes the net of the pin or pad, null is no net, the object form is gone', () => {
  const { A, GND } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R1')
  assert.equal(via(R1[1], '5 5').props.net, A)
  assert.equal(via(GND, '5 5', { drill: 0.3 }).props.drill, 0.3)
  assert.equal('net' in via(null, '1 1').props, false)
  assert.throws(() => via({ net: 'GND', at: '1 1' }), TypeError)
  const H1 = bindRef(PinHeader(2)().connect({ 1: A, 2: NC }), 'H1')
  assert.throws(() => via(H1[2], '1 1'), /connected to NC/)
})

/** R1 at (5, 5) and R2 at (20, 10), both on A and GND. */
function pair() {
  const { A, GND } = nets()
  return { A, R1: R0603('1k', { ref: 'R1' }).connect({ 1: A, 2: GND }), R2: R0603('1k', { ref: 'R2' }).connect({ 1: A, 2: GND }) }
}

test('via as a route end: route(pad, via).Z() ends at it, route(via, b) starts from it on any of its layers', () => {
  const { R1, R2 } = pair()
  const v = via(R1[1], '10 5')
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), v, route(R1[1], v).width(0.2).Z(), route(v, '20 5').layer('B.Cu').width(0.2).Z()))
  const tracks = b.items.filter(i => i.kind === 'track')
  assert.deepEqual(tracks[0].pts.at(-1), [10, 5])
  assert.equal(tracks[0].layer, 'F.Cu')
  assert.deepEqual(tracks[1].pts, [
    [10, 5],
    [20, 5],
  ])
  assert.equal(tracks[1].layer, 'B.Cu', 'a through via is met on B.Cu without a via of its own')
  assert.ok(
    tracks.every(t => t.net === 'A'),
    'the net of the via, where no pad gives one',
  )
  assert.equal(b.items.filter(i => i.kind === 'via').length, 1)
})

test('via as a route end inside a group: its position is read in the group frame', () => {
  const { R1, R2 } = pair()
  const v = via(R1[1], '5 0')
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), h('g', { at: '5 5' }, v, route(R1[1], v).width(0.2).Z())))
  const vi = b.items.find(i => i.kind === 'via')
  assert.deepEqual(vi.at, [10, 5])
  assert.deepEqual(b.items.find(i => i.kind === 'track').pts.at(-1), [10, 5])
})

test('the chain: an explicit .X() finish makes the same copper as the leg a chain that stops short gets, for the demo Blinky routes', () => {
  const make = explicit => {
    const { GND, SIG, SW } = nets()
    const J1 = bindRef(PinHeader(3)().connect({ 1: GND, 2: SIG, 3: SIG }), 'J1')
    const Q1 = bindRef(SOT23(3)('MMBT3904').connect({ 1: SIG, 2: GND, 3: SW }), 'Q1')
    const r = route(J1[3], Q1[1]).width(0.25).V(14).L(5, 16).via('B.Cu').H(24).V(7.5).via('F.Cu')
    return compileBoard(
      h(
        PCB,
        { name: 'Blinky', autoroute: { bend: '45', viaCost: 4 } },
        edge(),
        h(J1, { at: '3 7.46' }),
        h(Q1, { at: '26 10' }),
        explicit ? r.X() : r,
        route(Q1[2], '25 12.5 B.Cu').width(0.3),
      ),
    )
  }
  const s = make(false),
    c = make(true)
  assert.ok(copper(s).length > 6)
  assert.deepEqual(copper(c), copper(s))
})

test('the chain: units, relative commands, waypoints and a pair', () => {
  const { R1, R2 } = pair()
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), route(R1[1], R2[1]).width(0.2).h('1mm').v('-50mil').L('10 3').L(12, 3).Z()))
  const pts = b.items.filter(i => i.kind === 'track').map(t => t.pts.at(-1).map(n => Math.round(n * 1000) / 1000))
  assert.deepEqual(pts.slice(0, 4), [
    [5.175, 5],
    [5.175, 3.73],
    [10, 3],
    [12, 3],
  ])
  const r = route([R1[1], R2[1]], [R1[2], R2[2]]).via('B.Cu').impedance(90)
  assert.equal(r.props.pair, true)
  assert.throws(
    () => route([R1[1], R2[1]], R1[2]),
    e => e instanceof TypeError && /a differential pair has arrays at both ends/.test(e.message),
  )
})

test('the chain: .Z() and .X() finish it, .Z(target) is a TypeError, nothing follows a finish, and it closes once compiled', () => {
  const { R1, R2 } = pair()
  assert.throws(
    () => route(R1[1], R2[1]).Z(R2[1]),
    e => e instanceof TypeError && /\.Z\(\) takes no target/.test(e.message),
  )
  assert.throws(
    () => route(R1[1], R2[1]).X(R2[1]),
    e => e instanceof TypeError && /a pin, a pad, a pair or a net is an end/.test(e.message),
  )
  assert.throws(
    () => route(R1[1], R2[1]).Z().h(1),
    e => e instanceof TypeError && /chain ended at \.Z\(\) already/.test(e.message),
  )
  assert.throws(
    () => route(R1[1], R2[1]).X().width(0.3),
    e => e instanceof TypeError && /chain ended at \.X\(\) already/.test(e.message),
  )
  const r = route(R1[1], R2[1]).h(1).Z()
  compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), r))
  assert.throws(() => r.h(1), /compiled already/)
})

test('the chain: a chain from a pad that stops in the open is a compile error, a drawn chain from a coordinate needs .net()', () => {
  const { R1 } = pair()
  assert.throws(
    () => compileBoard(board(h(R1, { at: '5 5' }), route(R1[1]).h(3))),
    e => e instanceof CompileError && /ends in the open/.test(e.message),
  )
  assert.throws(
    () => compileBoard(board(h(R1, { at: '5 5' }), route(R1[1]))),
    e => e instanceof CompileError && /has no end/.test(e.message),
  )
  assert.throws(
    () => compileBoard(board(h(R1, { at: '5 5' }), route('3 10').H(9))),
    e => e instanceof CompileError && /needs \.net\(n\), or \.net\(null\)/.test(e.message),
  )
  assert.throws(
    () => compileBoard(board(h(R1, { at: '5 5' }), route('3 10').net(null).H(9).X('20 10'))),
    e => e instanceof CompileError && /copper on no net is drawn by hand/.test(e.message),
  )
  assert.throws(
    () => compileBoard(board(h(R1, { at: '5 5' }), route('3 10', '9 10').net(null))),
    e => e instanceof CompileError && /copper on no net is drawn by hand/.test(e.message),
  )
})

test('drawn copper: a chain from a coordinate on a net, or on no net, with .width() from where it is called and an arc', () => {
  const { A, GND } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R1')
  const b = compileBoard(board(h(R1, { at: '5 5' }), route('3 25').net(R1[1].net).H(10).A(15, 20, 90).width(0.5).V(12), route('3 28').net(null).H(10)))
  const tr = b.items.filter(i => i.kind === 'track')
  assert.deepEqual(
    tr.map(t => [t.net, t.width]),
    [
      ['A', 0.1524],
      ['A', 0.1524],
      ['A', 0.5],
      [undefined, 0.1524],
    ],
  )
  const arc = tr[1].prims
  assert.equal(arc.length, 1)
  assert.equal(arc[0].kind, 'arc')
  // 90 degrees counter-clockwise on screen from (10, 25) to (15, 20) turns about (10, 20)
  assert.deepEqual(
    arc[0].center.map(n => Math.round(n * 1e6) / 1e6),
    [10, 20],
  )
  assert.equal(arc[0].cw, false)
  assert.deepEqual(tr[1].pts.at(-1), [15, 20])
  assert.deepEqual(tr[0].pts, [
    [3, 25],
    [10, 25],
  ])
  assert.equal(b.drc.filter(f => f.rule === 'unconnected' && /no net/.test(f.message)).length, 0, 'copper on no net is never unconnected')
})

test('the ends list: route(a, b, c) joins c to the tree where cheapest, as one route', () => {
  const { A, GND } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R1'),
    R2 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R2'),
    R3 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R3')
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), h(R3, { at: '25 15' }), route(R1[1], R2[1], R3[1]).width(0.2)))
  const tr = b.items.filter(i => i.kind === 'track')
  assert.ok(tr.length >= 2)
  assert.ok(
    tr.every(t => t.route === 'route:1'),
    'every leg is route:1',
  )
  assert.equal(b.routing.legs, 2)
  assert.equal(b.drc.filter(f => f.rule === 'unconnected' && f.net === 'A').length, 0, 'net A is one island')
  assert.equal(b.routes.length, 1, 'one record for the route')
})

test('branches: .branch(b => b(end)…) forks at the chain point with its own width and via, the trunk going on after it', () => {
  const { A, GND } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R1'),
    R2 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R2'),
    R3 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R3')
  const b = compileBoard(
    board(
      h(R1, { at: '5 5 90' }),
      h(R2, { at: '15 15' }),
      h(R3, { at: '25 5 90' }),
      route(R1[1], R3[1])
        .width(0.3)
        .V(10)
        .H(12)
        .branch(c => c(R2[1]).width(0.2).V(12).via('B.Cu').V(14).via('F.Cu').V(15).Z())
        .H(25)
        .Z(),
    ),
  )
  const tr = b.items.filter(i => i.kind === 'track')
  const trunk = tr.filter(t => t.width === 0.3),
    branch = tr.filter(t => t.width === 0.2)
  assert.ok(trunk.length >= 3 && branch.length >= 2)
  assert.deepEqual(branch[0].pts[0], [12, 10], 'the branch starts at the fork')
  assert.ok(branch.some(t => t.layer === 'B.Cu'))
  assert.equal(b.items.filter(i => i.kind === 'via').length, 2)
  assert.ok(tr.every(t => t.route === 'route:1'))
  assert.throws(() => route(R1[1], R3[1]).branch(c => c(A)), TypeError)
  assert.throws(() => route(R1[1], R3[1]).branch(() => 1), /returns the one sub-chain it makes/)
})

test('branches: a trunk that ends in branches needs no end of its own', () => {
  const { A, GND } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R1'),
    R2 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R2')
  const b = compileBoard(
    board(
      h(R1, { at: '5 5' }),
      h(R2, { at: '20 10' }),
      route(R1[1])
        .h(-2)
        .branch(c => c(R2[1])),
    ),
  )
  assert.equal(b.routing.legs, 1)
  assert.equal(b.drc.filter(f => f.rule === 'unconnected' && f.net === 'A').length, 0)
})

test('a net as the end: route(end, NET).V(…) runs its manual tail, then joins the copper of the net', () => {
  const { A, GND } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R1'),
    R2 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R2')
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), route(R1[1], A).width(0.2).V(8)))
  const tr = b.items.filter(i => i.kind === 'track')
  assert.deepEqual(tr[0].pts, [
    [4.175, 5],
    [4.175, 8],
  ])
  assert.equal(b.drc.filter(f => f.rule === 'unconnected' && f.net === 'A').length, 0)
  assert.throws(() => route(R1[1], A, R2[1]), /the only end after the first/)
})

test('route(NET): every pad of the net joins a tree from its first pad, or from the pad .root() names', () => {
  const { A, GND } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R1'),
    R2 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R2'),
    R3 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R3')
  const parts = () => [h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), h(R3, { at: '25 15' })]
  for (const r of [route(A).width(0.2), route(A).width(0.2).root(R3[1])]) {
    const b = compileBoard(board(...parts(), r))
    assert.equal(b.routing.legs, 2)
    assert.equal(b.drc.filter(f => f.rule === 'unconnected' && f.net === 'A').length, 0)
    assert.ok(b.items.filter(i => i.kind === 'track').every(t => t.route === 'route:1'))
  }
  assert.throws(() => route(R1[1], R2[1]).root(R1[1]), /names the root of route\(NET\)/)
  assert.throws(() => route(A, R1[1]), /put the net last/)
  assert.throws(
    () => compileBoard(board(...parts(), route(A).V(3))),
    e => e instanceof CompileError && /takes no chain/.test(e.message),
  )
})

test('.X(p): an automatic waypoint, the leg after it running on to the end', () => {
  const { R1, R2 } = pair()
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), route(R1[1], R2[1]).width(0.2).X('12 16')))
  assert.equal(b.routing.legs, 2)
  const pts = b.items.filter(i => i.kind === 'track').flatMap(t => t.pts)
  assert.ok(
    pts.some(q => Math.hypot(q[0] - 12, q[1] - 16) < 1e-6),
    'the copper passes the waypoint',
  )
})

test('iterables as children: a generator compiles like an array, every time, and a bad yield names its position', () => {
  const { R1, R2 } = pair()
  function* parts() {
    yield h(R1, { at: '5 5' })
    yield [h(R2, { at: '20 10' })]
    yield new Set([route(R1[1], R2[1]).width(0.2)])
  }
  const tree = board(parts())
  const a = compileBoard(tree),
    b = compileBoard(tree)
  assert.equal(a.footprints.length, 2)
  assert.deepEqual(copper(b), copper(a), 'the generator was read once and kept')
  function* bad() {
    yield h(R1, { at: '5 5' })
    yield { at: '1 1' }
  }
  assert.throws(
    () => compileBoard(board(bad())),
    e => e instanceof CompileError && /unexpected child \{"at":"1 1"\}, yield 2 of an iterable child/.test(e.message),
  )
})

test('types: the chain, .net and the via end type check, and tsc rejects a bad chain', async () => {
  const ts = (await import('typescript')).default
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const core = fileURLToPath(import.meta.resolve('@pcbjs/core'))
  const lib = fileURLToPath(import.meta.resolve('@pcbjs/lib'))
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-chain-'))
  const lines = [
    `import { nets, route, via, pour, keepout, type Net, type RouteBuilder, type ViaNode, type PcbNode } from ${JSON.stringify(core)}`,
    `import { USBC, SOIC } from ${JSON.stringify(lib)}`,
    `const { DP, DN } = nets()`,
    `const J1 = USBC('full16')('x').connect({ DP, DN })`,
    `const U1 = SOIC(8)('x')`,
    `const SMALL = { drill: 0.2, size: 0.45 }`,
    `export const n: Net = J1.B6.net`,
    `export const v: ViaNode = via(J1.B6.net, '11.25 6.2', SMALL)`,
    `export const w: ViaNode = via(J1.A6, '12.25 6.2')`,
    `export const free: ViaNode = via(null, '1 1')`,
    `export const r: RouteBuilder = route(J1.B6, v).width(0.2).h(1.0).v('10mil').X('100mil 200mil').via('In1.Cu').A(3, 4, 90).Z()`,
    `export const t: RouteBuilder = route(J1.B6, U1[1], U1[2]).branch(b => b(U1[3]).width(0.1).V(2).Z())`,
    `export const s: RouteBuilder = route(DP).root(J1.B6)`,
    `export const d: RouteBuilder = route('3 10').net(null).H(9)`,
    `export const p: RouteBuilder = route([J1.DP, J1.DN], [U1[1], U1[2]]).via('B.Cu').impedance(90).gap(0.15)`,
    `export const g: Iterable<PcbNode> = (function* () { yield v; yield route(v, U1[3]) })()`,
    `export const z: PcbNode = pour(null, 'F.Cu', 'M 0 0 H 5 V 5 Z')`,
    `export const k: PcbNode = keepout('M 0 0 H 5 V 5 Z', { layers: ['B.Cu'], vias: false })`,
    `// @ts-expect-error H takes one length`,
    `export const bad1 = route(J1.B6, v).H(1, 2)`,
    `// @ts-expect-error via takes a layer name`,
    `export const bad2 = route(J1.B6, v).via(2)`,
    `// @ts-expect-error .Z() takes no target`,
    `export const bad3 = route(J1.B6, v).Z(DP)`,
    `// @ts-expect-error .rules() takes no layers, .layers() does`,
    `export const bad4 = route(J1.B6, v).rules({ layers: ['F.Cu'] })`,
  ]
  const file = join(dir, 'fixture.ts')
  writeFileSync(file, lines.join('\n') + '\n')
  try {
    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
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

test('chain tuples: a tuple of two numbers, or two numbers and a layer, is one position as an end and as a waypoint', () => {
  for (const t of [
    [25, 15],
    [25, 15, 'F.Cu'],
    ['25mm', 15],
  ]) {
    const { A, B } = nets()
    const R1 = bindRef(R0603('1k').connect({ 1: A, 2: B }), 'R1')
    const b = compileBoard(board(h(R1, { at: '5 5' }), route(R1[1], t).width(0.3).Z()))
    const tr = b.items.filter(i => i.kind === 'track')
    assert.equal(tr.length, 1, JSON.stringify(t))
    assert.deepEqual(tr[0].pts.at(-1), [25, 15])
  }
  const { C, D } = nets()
  const R2 = bindRef(R0603('1k').connect({ 1: C, 2: D }), 'R2')
  const b = compileBoard(board(h(R2, { at: '5 5' }), route(R2[1], [20, 10]).width(0.3).L([10, 10]).Z()))
  assert.deepEqual(
    b.items
      .filter(i => i.kind === 'track')
      .flatMap(t => t.pts)
      .at(-1),
    [20, 10],
  )
})

test('chain tuples: a pair end is two handles or two positions, and a tuple waypoint in a pair chain is a position', () => {
  const { P, N } = nets()
  const Ra = bindRef(R0603('1k').connect({ 1: P, 2: N }), 'Ra')
  const Rb = bindRef(R0603('1k').connect({ 1: P, 2: N }), 'Rb')
  // a tuple waypoint between the two pair ends
  const b = compileBoard(board(h(Ra, { at: '5 10 90' }), h(Rb, { at: '25 10 90' }), route([Ra[1], Ra[2]], [Rb[1], Rb[2]]).width(0.2).gap(0.3).L([12, 10]).Z()))
  assert.equal(b.items.filter(i => i.kind === 'track').length, 2)
  assert.throws(
    () => compileBoard(board(h(Ra, { at: '5 10 90' }), h(Rb, { at: '25 10 90' }), route([Ra[1], Ra[2]], [Rb[1], Rb[2]]).X([12, 10, 'B.Cu']).Z())),
    e => e instanceof CompileError && /waypoint \[12,10,"B.Cu"\] names a layer; .* write it as \[12, 10\] and change layer with \.via\('B.Cu'\)/.test(e.message),
  )
  const { Q } = nets()
  const R3 = bindRef(R0603('1k').connect({ 1: Q, 2: Q }), 'R3')
  assert.throws(() => route(R3[1], [R3[1], R3[2]]), /b is a pair end \[P, N\] but a is a single end/)
})

test('route cache: a warm route(a, b) takes its leg from the cache; an extra end or another branch keys its legs apart', () => {
  clearRouteCache()
  const { A, GND } = nets()
  const R1 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R1'),
    R2 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R2'),
    R3 = bindRef(R0603('1k').connect({ 1: A, 2: GND }), 'R3')
  const make = r => compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), h(R3, { at: '25 15' }), r()))
  const plain = () => route(R1[1], R2[1]).width(0.2)
  make(plain)
  assert.equal(make(plain).routing.cached, 1, 'a warm plain route is a cache hit')
  // the same R1 to R2 leg in a route with a third end is keyed on the whole route
  assert.equal(make(() => route(R1[1], R2[1], R3[1]).width(0.2)).routing.cached, 0)
  const branched = v => () =>
    route(R1[1], R3[1])
      .width(0.2)
      .h(-1)
      .branch(c => c(R2[1]).V(v))
  make(branched(8))
  assert.equal(make(branched(8)).routing.cached, 2, 'a warm branched route is all cache hits')
  assert.equal(make(branched(7)).routing.cached, 0, 'another branch shares no leg entry, the trunk leg included')
  clearRouteCache()
})

test('the chain: .via(layer, { drill, size }) sets that via, the next takes the route default, and a bad option throws', () => {
  const { R1, R2 } = pair()
  const b = compileBoard(board(h(R1, { at: '5 5' }), h(R2, { at: '20 10' }), route(R1[1], R2[1]).width(0.2).H(9).via('B.Cu', { drill: 0.25, size: '0.5mm' }).H(14).via('F.Cu').Z()))
  const vias = b.items.filter(i => i.kind === 'via')
  assert.equal(vias.length, 2)
  assert.deepEqual([vias[0].drill, vias[0].size], [0.25, 0.5])
  assert.notDeepEqual([vias[1].drill, vias[1].size], [0.25, 0.5])
  assert.throws(() => route(R1[1], R2[1]).via('B.Cu', { span: 2 }), /drill, size/)
  assert.throws(() => route(R1[1], R2[1]).via('B.Cu', { drill: 'wide' }), /length/)
})
