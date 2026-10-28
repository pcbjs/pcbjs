// The router's fixes of round 3: a cached leg is checked against the other cached legs before it is reused, priority holds
// in negotiation and against cached legs, a pair's fans and via pairs are reserved before other legs route, a pair whose
// ends are the wrong way round is reported before routing and can cross over at a via pair, and the tuning floors are named.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { clearRouteCache, hash } from '@pcbjs/compile/route-cache'

afterEach(() => resetDefaults())

const edge = (w = 30, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const smd = (ref, x, y, net, size = 1) => h('footprint', { ref, at: [x, y], nets: { 1: net } }, h('pad', { num: 1, size, type: 'smd' }))
/** Two smd pads `d` mm apart side by side, pad 1 on `a` at -x, pad 2 on `b` at +x. */
const two = (ref, x, y, a, b, d = 0.5, size = [0.3, 1]) =>
  h('footprint', { ref, at: [x, y], nets: { 1: a, 2: b } }, h('pad', { num: 1, at: [-d / 2, 0], size, type: 'smd' }), h('pad', { num: 2, at: [d / 2, 0], size, type: 'smd' }))
const tracks = (b, net) => b.items.filter(i => i.kind === 'track' && (net === undefined || i.net === net))
const copper = b => b.items.filter(i => i.kind === 'track' || i.kind === 'via').map(i => [i.kind, i.net, i.layer, i.pts ?? i.at])
const errors = b => b.drc.filter(d => d.severity === 'error').map(d => `${d.rule}: ${d.message}`)
const findings = (b, rule) => b.drc.filter(d => d.rule === rule)
const withDir = async f => {
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-r3-'))
  try {
    clearRouteCache()
    return await f(dir)
  } finally {
    clearRouteCache()
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---- 1. the cache ----

test('cache: two stored legs that cross, each with a matching obstacle hash, are not both reused: the later one routes again', () =>
  withDir(dir => {
    // A runs across, B down through it on F.Cu only by the stored result; B on two layers can go under A
    const mk = () =>
      h(
        PCB,
        { name: 'Bad' },
        edge(),
        smd('A1', 3, 10, 'A'),
        smd('A2', 27, 10, 'A'),
        smd('B1', 15, 3, 'B'),
        smd('B2', 15, 17, 'B'),
        route('A1.1', 'A2.1').width(0.25).layers(['F.Cu']),
        route('B1.1', 'B2.1').width(0.25),
      )
    const opts = { routeCache: { dir } }
    const cold = compileBoard(mk(), opts)
    assert.deepEqual(errors(cold), [])
    // a cache as a run that went wrong left it: B straight across A on F.Cu, and both obstacle hashes over an empty box far away,
    // so the hash check alone passes both
    const file = join(dir, 'Bad.json'),
      data = JSON.parse(readFileSync(file, 'utf8'))
    const legs = data.groups[''].legs,
      far = [1000, 1000, 1001, 1001],
      empty = hash('')
    for (const e of Object.values(legs)) {
      e.box = far
      e.obs = empty
      if (e.result.tracks[0].pts[0][0] === 15) {
        e.result.tracks = [
          {
            layer: 'F.Cu',
            pts: [
              [15, 3],
              [15, 17],
            ],
          },
        ]
        e.result.vias = []
      }
    }
    writeFileSync(file, JSON.stringify(data))
    clearRouteCache()
    const warm = compileBoard(mk(), opts)
    assert.deepEqual(findings(warm, 'short'), [], 'the stored legs that cross are not both placed')
    assert.deepEqual(errors(warm), [])
    assert.equal(warm.routing.cached, 1, 'A, first in order, is reused; B routes again')
    assert.deepEqual(copper(warm), copper(cold))
  }))

test('cache: a cold and a warm compile give the same items, and the warm one takes every leg from the file', () =>
  withDir(dir => {
    const mk = () =>
      h(
        PCB,
        { name: 'Same' },
        edge(),
        two('J1', 10, 3, 'DP', 'DN', 2),
        two('J2', 10, 17, 'DP', 'DN', 2),
        smd('C1', 3, 6, 'C'),
        smd('C2', 27, 6, 'C'),
        route(['J1.1', 'J1.2']).X(['J2.1', 'J2.2']).width(0.2).gap(0.2).priority(2),
        route('C1.1', 'C2.1').width(0.25).priority(-1),
      )
    const cold = compileBoard(mk(), { routeCache: { dir } })
    clearRouteCache()
    const warm = compileBoard(mk(), { routeCache: { dir } })
    assert.equal(warm.routing.cached, warm.routing.legs)
    assert.deepEqual(warm.items, cold.items)
  }))

// ---- 2. priority ----

test('priority: a route of higher priority added over a cached route of lower priority routes through it, and the lower one moves, as in a cold compile', () =>
  withDir(dir => {
    const base = [smd('L1', 3, 10, 'L'), smd('L2', 27, 10, 'L'), route('L1.1', 'L2.1').width(0.25).priority(-1)]
    const opts = { routeCache: { dir } }
    const first = compileBoard(h(PCB, { name: 'Pri' }, edge(), ...base), opts)
    assert.deepEqual(
      tracks(first, 'L').map(t => t.pts),
      [
        [
          [3, 10],
          [27, 10],
        ],
      ],
    )
    const added = () => h(PCB, { name: 'Pri' }, edge(), ...base, smd('H1', 15, 3, 'H'), smd('H2', 15, 17, 'H'), route('H1.1', 'H2.1').width(0.25).priority(1))
    const warm = compileBoard(added(), opts)
    assert.deepEqual(
      tracks(warm, 'H').map(t => t.pts),
      [
        [
          [15, 3],
          [15, 17],
        ],
      ],
      'H runs straight through where L was',
    )
    assert.deepEqual(errors(warm), [])
    const cold = compileBoard(added(), { routeCache: false })
    assert.deepEqual(copper(warm), copper(cold))
  }))

test('priority: in negotiation the legs of higher priority keep their straight path and the lower ones give way', () => {
  // the tangle of autoroute.test.mjs: two routes across, three down, one layer; with the two across of higher priority,
  // they run straight whatever the order, and what does not fit is a route of lower priority
  const kids = [
    smd('A1', 0.9, 4.5, 'A'),
    smd('A2', 19.1, 4.5, 'A'),
    smd('E1', 0.9, 6, 'E'),
    smd('E2', 19.1, 6, 'E'),
    ...[5, 10, 15].flatMap((x, i) => {
      const n = 'BCD'[i]
      return [smd(`${n}1`, x, 1.6, n), smd(`${n}2`, x, 8.4, n)]
    }),
    ...['B', 'C', 'D'].map(n => route(`${n}1.1`, `${n}2.1`).width(0.25).layers(['F.Cu'])),
    ...['A', 'E'].map(n => route(`${n}1.1`, `${n}2.1`).width(0.25).layers(['F.Cu']).priority(1)),
  ]
  const b = compileBoard(h(PCB, { name: 'Tangle' }, edge(20, 10), ...kids), { routeCache: false })
  for (const n of ['A', 'E']) assert.equal(tracks(b, n).length, 1, `${n} is placed`)
  assert.deepEqual(
    tracks(b, 'A')[0].pts,
    [
      [0.9, 4.5],
      [19.1, 4.5],
    ],
    'A runs straight',
  )
  assert.deepEqual(
    tracks(b, 'E')[0].pts,
    [
      [0.9, 6],
      [19.1, 6],
    ],
    'E runs straight',
  )
  for (const f of findings(b, 'route-failed')) assert.match(f.message, /net [BCD] /)
  assert.deepEqual(findings(b, 'short'), [])
})

// ---- 3. pair reservations ----

test("pair reservation: a route of lower priority keeps clear of a pair's wide fan, which its centre line does not cover", () => {
  // pads 2 mm apart fan in to a 0.4 mm pitch over 0.8 mm past the pads; C crosses right there
  const b = compileBoard(
    h(
      PCB,
      { name: 'Fan' },
      edge(),
      two('J1', 10, 3, 'DP', 'DN', 2),
      two('J2', 10, 17, 'DP', 'DN', 2),
      smd('C1', 3, 4.1, 'C', 0.6),
      smd('C2', 27, 4.1, 'C', 0.6),
      route(['J1.1', 'J1.2']).X(['J2.1', 'J2.2']).width(0.2).gap(0.2).priority(2),
      route('C1.1', 'C2.1').width(0.2).priority(-1),
    ),
    { routeCache: false },
  )
  assert.deepEqual(errors(b), [])
  assert.equal(b.unconnected, 0)
})

// ---- 4. handedness and the crossover ----

const mirrored = chain => h(PCB, { name: 'X' }, edge(), two('J1', 10, 3, 'DP', 'DN'), two('J2', 10, 17, 'DN', 'DP'), chain.width(0.2).gap(0.2))

test('pair handedness: ends the wrong way round for an automatic path are a route-failed before any routing', () => {
  const b = compileBoard(mirrored(route(['J1.1', 'J1.2']).V(8).X('10 12').Z(['J2.2', 'J2.1'])), { routeCache: false })
  const [f] = findings(b, 'route-failed')
  assert.match(f.message, /the pair would have to cross itself: P leaves its start pad on the right .* swap P and N at a via pair with \.cross\(layer\)/)
  assert.equal(b.routing.legs, 1)
  assert.equal(b.routing.routed, 0, 'not routed at all')
  assert.equal(tracks(b).length, 0)
})

test('pair crossover: .cross(layer) swaps P and N at a via pair, and the pair joins mirrored ends cleanly', () => {
  for (const chain of [
    route(['J1.1', 'J1.2']).V(7).cross('B.Cu').V(11).via('F.Cu').Z(['J2.2', 'J2.1']),
    route(['J1.1', 'J1.2']).V(7).cross('B.Cu').X(['J2.2', 'J2.1']).layers(['F.Cu', 'B.Cu']),
  ]) {
    const b = compileBoard(mirrored(chain), { routeCache: false })
    assert.deepEqual(errors(b), [])
    assert.equal(b.unconnected, 0)
    // DP leaves on the right of travel, x 9.75, and arrives on the left of it at J2, x 10.25
    const dp = tracks(b, 'DP').flatMap(t => t.pts)
    assert.ok(dp.some(p => Math.abs(p[0] - 9.75) < 1e-6) && dp.some(p => Math.abs(p[0] - 10.25) < 1e-6))
  }
  assert.throws(() => route('J1.1').cross('B.Cu'), { name: 'TypeError', message: /cross\(\) is for a differential pair/ })
})

// ---- 5. tuning floors ----

test('tuning floors: a pair short of its length by less than the smallest pair meander, and a skew below the smallest bump, say so', () => {
  const pads = (ref, y) =>
    h(
      'footprint',
      { ref, at: [15, y], nets: { 1: 'DP', 2: 'DN' } },
      h('pad', { num: 1, at: [-0.16, 0], size: [0.17, 0.5], type: 'smd' }),
      h('pad', { num: 2, at: [0.16, 0], size: [0.17, 0.5], type: 'smd' }),
    )
  const b = compileBoard(
    h(
      PCB,
      { name: 'T' },
      edge(30, 30),
      pads('J1', 3),
      pads('J2', 27),
      route(['J1.1', 'J1.2']).Z(['J2.1', 'J2.2']).width(0.17).gap(0.15).skew(1).length({ target: 24.3, tolerance: 0.05 }),
    ),
    { routeCache: false },
  )
  const [f] = findings(b, 'length')
  assert.match(f.message, /0\.30 mm missing, below the smallest pair meander of 0\.39 mm, 2 pi - 4 times the larger of the width and half the pitch/)
  assert.doesNotMatch(f.message, /free run/)
})

// ---- the pair gap inside a class of larger clearance ----

test('pair clearance: between the tracks and vias of one pair the gap governs, not a larger class clearance', async () => {
  const { nets } = await import('@pcbjs/core')
  const { DP, DN } = nets({ DP: { class: 'ss' }, DN: { class: 'ss' } })
  const b = compileBoard(
    h(
      PCB,
      { name: 'Gap', classes: { ss: { clearance: 0.3, gap: 0.2, width: 0.2 } } },
      edge(),
      two('J1', 10, 3, DP, DN, 0.8),
      two('J2', 10, 17, DP, DN, 0.8),
      route(['J1.1', 'J1.2']).V(8).via('B.Cu').X(['J2.1', 'J2.2']).layers(['F.Cu', 'B.Cu']),
    ),
    { routeCache: false },
  )
  assert.deepEqual(errors(b), [])
  assert.equal(b.unconnected, 0)
  assert.equal(b.pairs[0].gap, 0.2)
})
