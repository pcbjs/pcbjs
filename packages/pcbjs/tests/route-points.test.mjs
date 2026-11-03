// Route points: `.start`, `.end` and `.pt(k)` of a route as route ends and `at:follow` anchors, a route a circuit build returns
// as an instance handle `ch2.vccTrunk`, and the references `CH2/route:vccTrunk/pt:1` that name them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, circuit, layout, route, bindRef } from '@pcbjs/core'
import { R0603, LED0603, PinHeader } from '@pcbjs/lib'
import { compileBoard, CompileError } from '@pcbjs/compile'
import { boardIndex, parseRef, printRef, resolveRef } from '@pcbjs/core/ref'

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const board = (...children) => h(PCB, { name: 'Pts' }, edge(), ...children)
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6

const chan = circuit('chan', ({ VCC, SW }, { nets: { led } }) => {
  const R01 = R0603('330').connect({ 1: VCC, 2: led })
  const D01 = LED0603('green').connect({ A: led, K: SW })
  const vccTrunk = route('2 0').net(VCC).width(0.3).H(4.175)
  return { R01, D01, vccTrunk }
})
const Row = layout(chan, (g, { at }) => h('g', { at }, h(g.R01, { at: '5 0' }), h(g.D01, { at: '10 0 180deg' }), g.vccTrunk, route(g.R01[2], g.D01.A).width(0.3)), 'Row')

test('a route of an instance is a handle, ch2.vccTrunk, and its end a route end that routes to that point', () => {
  const { VCC, SW, GND } = nets()
  const ch2 = chan({ VCC, SW }, 'CH2')
  const J1 = bindRef(PinHeader(3)(), 'J1').connect({ 1: GND, 2: VCC, 3: SW })
  assert.equal(ch2.vccTrunk.end.pt, 'end')
  assert.equal(ch2.vccTrunk.pt(1).route, ch2.vccTrunk)
  assert.throws(() => ch2.vccTrunk.pt(-1), /takes a whole number/)
  // the route to the point comes first in the tree: it waits for the trunk it ends on
  const b = compileBoard(board(route(J1[2], ch2.vccTrunk.end).width(0.3), h(J1, { at: '20 8' }), h(Row, { g: ch2, at: '0 5' })), { cache: false })
  assert.deepEqual(
    b.drc.filter(d => d.severity === 'error' && !d.refs.includes('net:SW')),
    [],
  )
  assert.ok(b.routes.some(r => r.id === 'CH2/route:vccTrunk'))
  const trunk = resolveRef(boardIndex(b), 'CH2/route:vccTrunk')
  assert.deepEqual(trunk.route.pts, [
    [2, 5],
    [4.175, 5],
  ])
  const pt = resolveRef(boardIndex(b), 'CH2/route:vccTrunk/pt:1')
  assert.equal(pt.kind, 'pt')
  assert.deepEqual(pt.at, [4.175, 5])
  const to = b.routes.find(r => r.id === 'route:1')
  assert.ok(near(to.pts.at(-1), [4.175, 5]), JSON.stringify(to.pts))
  assert.ok(b.items.some(it => it.kind === 'track' && it.route === 'route:1' && it.pts.some(p => near(p, [4.175, 5]))))
  assert.equal(resolveRef(boardIndex(b), 'route:vccTrunk/pt:0').at[0], 2, 'a unique tail of the path resolves')
})

test('the grammar: an instance path then route:, round trip, and what it refuses', () => {
  for (const r of ['CH2/route:vccTrunk/pt:2', 'Power/CH2/route:vccTrunk', 'CH2/route:vccTrunk/leg:1', 'board:Blinky/CH2/route:vccTrunk/pt:0'])
    assert.equal(printRef(parseRef(r)), r)
  assert.throws(() => parseRef('CH2/net:VCC'), /no typed segment but a route of an instance/)
  assert.throws(() => parseRef('CH2/route:vccTrunk/span:F.Cu..B.Cu'), /takes leg: or pt: under it/)
})

test('a route of an instance never placed, and a route point of a route not on the board, are compile errors', () => {
  const { VCC, SW, GND } = nets()
  const Bare = layout(chan, (g, { at }) => h('g', { at }, h(g.R01, { at: '5 0' }), h(g.D01, { at: '10 0 180deg' })), 'Bare')
  const ch3 = chan({ VCC, SW }, 'CH3')
  assert.throws(
    () => compileBoard(board(h(Bare, { g: ch3, at: '0 5' })), { cache: false }),
    e => e instanceof CompileError && /the route CH3\.vccTrunk of the circuit chan is never placed/.test(e.message),
  )
  const J1 = bindRef(PinHeader(3)(), 'J1').connect({ 1: GND, 2: VCC, 3: SW })
  const lone = route('1 1').net(VCC).H(3)
  assert.throws(() => compileBoard(board(h(J1, { at: '20 8' }), route(J1[2], lone.end)), { cache: false }), /its route is not placed on this board/)
})

test('at:follow near a route point', () => {
  const { VCC, SW, GND } = nets()
  const ch4 = chan({ VCC, SW }, 'CH4')
  const J1 = bindRef(PinHeader(3)(), 'J1').connect({ 1: GND, 2: VCC, 3: SW })
  const C1 = bindRef(R0603('10k'), 'C1').connect({ 1: SW, 2: GND })
  const b = compileBoard(board(h(J1, { at: '20 8' }), h(Row, { g: ch4, at: '0 5' }), h(C1, { 'at:follow': { route: ch4.vccTrunk, near: ch4.vccTrunk.start }, at: 'auto' })), {
    cache: false,
  })
  const c = b.footprints.find(f => f.value === '10k')
  assert.ok(Math.hypot(c.at[0] - 2, c.at[1] - 5) < 3, JSON.stringify(c.at))
})
