// Followers and route solvers: at:follow places a part beside routed copper after routing and routes its own legs after it; .solver() lays a leg out before the router.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { nets, route } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { fp, handle } from './parts.mjs'

const edge = (w = 30, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const yard = (w, hh) => h('rect', { layer: 'F.CrtYd', x: -w / 2, y: -hh / 2, w, h: hh, width: 0.05 })
const chip = (ref, place, a, b) =>
  fp(
    { ref, ...place, nets: { 1: a, 2: b } },
    h('pad', { num: 1, at: '-0.75 0', size: [0.8, 0.9], type: 'smd' }),
    h('pad', { num: 2, at: '0.75 0', size: [0.8, 0.9], type: 'smd' }),
    yard(2.6, 1.6),
  )
const board = (...kids) => h(PCB, { name: 'Follow' }, edge(), ...kids)
const at = (b, ref) => b.footprints.find(f => f.ref === ref)
const thrown = f => {
  try {
    f()
  } catch (e) {
    return e
  }
  return null
}
const segDist = (p, a, b) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

test('at:follow: the part sits beside its route near the pad it names, turned along it, and its own legs route after it', () => {
  const N = nets()
  const trunk = route(handle('J1.1'), handle('U1.1')).width(0.5)
  const b = compileBoard(
    board(
      chip('J1', { at: '4 10' }, N.VIN, N.X),
      chip('U1', { at: '26 10' }, N.VIN, N.GND),
      chip('J2', { at: '26 16' }, N.GND, N.Y),
      trunk,
      route(handle('U1.2'), handle('J2.1')),
      chip('C1', { 'at:follow': { route: trunk, near: handle('U1.1') } }, N.VIN, N.GND),
      route(handle('C1.1'), N.VIN),
      route(handle('C1.2'), N.GND),
    ),
  )
  const c = at(b, 'C1')
  const own = b.items.filter(i => i.kind === 'track' && i.route === 'route:1')
  const d = Math.min(...own.flatMap(t => t.pts.slice(1).map((q, i) => segDist(c.at, t.pts[i], q))))
  assert.ok(d > 1 && d < 2, `C1 is ${d} mm from the trunk`)
  assert.ok(c.at[0] > 20, `C1 sits near U1, at ${c.at}`)
  assert.equal(c.rot % 180, 0)
  assert.deepEqual(
    b.placed.map(p => [p.ref, p.by]),
    [['C1', 'follow']],
  )
  assert.equal(b.unconnected, 0)
  assert.deepEqual(
    b.drc.filter(x => x.severity === 'error'),
    [],
  )
  assert.equal(b.routing.legs, 4)
})

test('follow-cycle: a follower whose pad is an end of the route it follows', () => {
  const N = nets()
  const r = route(handle('J1.1'), handle('C1.1'))
  const e = thrown(() => compileBoard(board(chip('J1', { at: '4 10' }, N.A, N.B), r, chip('C1', { 'at:follow': { route: r } }, N.A, N.B))))
  assert.equal(e?.code, 'follow-cycle')
  assert.match(e.message, /^a follower cycle: C1.*route:1/)
})

test('at:follow: a follower beside a route that ends on another follower is a compile error, the pass running once', () => {
  const N = nets()
  const a = route(handle('J1.1'), handle('J2.1'))
  const b2 = route(handle('J1.2'), handle('C1.2'))
  const e = thrown(() =>
    compileBoard(
      board(
        chip('J1', { at: '4 10' }, N.A, N.B),
        chip('J2', { at: '26 10' }, N.A, N.C),
        a,
        b2,
        chip('C1', { 'at:follow': { route: a } }, N.C, N.B),
        chip('C2', { 'at:follow': { route: b2 } }, N.C, N.D),
      ),
    ),
  )
  assert.match(String(e?.message), /C2: at:follow follows route:2, which ends on the follower C1/)
})

const straight = (req, ctx) => ({
  tracks: [
    {
      layer: req.start.layer,
      pts: [
        [req.start.x, req.start.y],
        [req.end.x, req.end.y],
      ],
    },
  ],
  vias: [],
})

test('.solver(): its copper takes the leg before the router, null leaves the leg to the router', () => {
  const N = nets()
  const solved = compileBoard(board(chip('J1', { at: '4 10' }, N.A, N.B), chip('J2', { at: '26 10' }, N.A, N.C), route(handle('J1.1'), handle('J2.1')).solver(straight)))
  const [t] = solved.items.filter(i => i.kind === 'track' && i.net === 'A')
  assert.deepEqual(t.pts, [
    [3.25, 10],
    [25.25, 10],
  ])
  assert.equal(solved.routing.solved, 1)
  const left = compileBoard(
    board(
      chip('J1', { at: '4 10' }, N.A, N.B),
      chip('J2', { at: '26 10' }, N.A, N.C),
      route(handle('J1.1'), handle('J2.1')).solver(() => null),
    ),
  )
  assert.equal(left.routing.solved, undefined)
  assert.equal(left.routing.routed, 1)
})

test('solver-order: a route solver reading a route routed after it, and one it may read', () => {
  const N = nets()
  const later = route(handle('J1.2'), handle('J2.2'))
  const e = thrown(() =>
    compileBoard(
      board(
        chip('J1', { at: '4 10' }, N.A, N.B),
        chip('J2', { at: '26 10' }, N.A, N.B),
        route(handle('J1.1'), handle('J2.1')).solver((req, ctx) => (ctx.route(later), null)),
        later,
      ),
    ),
  )
  assert.equal(e?.code, 'solver-order')
  assert.match(e.message, /made after it: route:1.* → route:2/)
  const first = route(handle('J1.1'), handle('J2.1')).solver(straight)
  let read = null
  const ok = compileBoard(
    board(
      chip('J1', { at: '4 10' }, N.A, N.B),
      chip('J2', { at: '26 10' }, N.A, N.B),
      first,
      route(handle('J1.2'), handle('J2.2')).solver((req, ctx) => ((read = ctx.route(first)), null)),
    ),
  )
  assert.equal(read.tracks.length, 1)
  assert.equal(ok.routing.solved, 1)
})
