// Kind scoped clearances: `clearance` by the kind of the other item on a pad, a part, a class and a net, `self` between the pads
// of one footprint, their resolution between two items, and the router and the zone fill keeping them.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route, nets, pour, defineFootprint, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { itemClearance, overrideBetween } from '@pcbjs/compile/netclass'
import { ObstacleStore } from '../../compile/dist/obstacles.js'
import { polysToRings, intersection } from '../../compile/dist/geom.js'

afterEach(() => resetDefaults())

const opts = { routeCache: false }
const edge = (w = 20, hh = 10) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const R = { clearance: 0.2, edgeClearance: 0.4, holeClearance: 0.3 }
const errs = (b, rule) => b.drc.filter(d => d.rule === rule)
const mk = (props, ...kids) => compileBoard(h(PCB, { name: 'K', rules: R, ...props }, edge(), ...kids), opts)
const padOf = (b, ref, num) => b.items.find(i => i.kind === 'pad' && i.ref === ref && i.num === String(num))
/** a header of two 1 mm pads 0.25 mm apart, edge to edge */
const Hdr = defineFootprint(
  ({ p1 = {}, ...props }) => h('footprint', props, h('pad', { num: 1, at: '0 0', size: 1, shape: 'rect', ...p1 }), h('pad', { num: 2, at: '1.25 0', size: 1, shape: 'rect' })),
  { pins: ['1', '2'], prefix: 'J' },
)
/** a track of net `n` along y = 5 + 0.5 + gap + w/2 under a header at 5 5, w 0.2 */
const under = (n, gap) => line(n, 2, 5.5 + gap + 0.1, 9)
/** a straight 0.2 mm track of net n on F.Cu at height y from x0 to x1 */
const line = (n, x0, y, x1) => h('track', { net: n, layer: 'F.Cu', width: 0.2, d: `M${x0} ${y} H${x1}` })

test('kind clearance: a part override by kind holds toward that kind only, not between its own pads', () => {
  const { A, B, C } = nets()
  // a plain 0.4 holds pad to pad too: the header's own pads 0.25 apart are an error
  const plain = mk({}, h(Hdr().connect(A, B).rules({ clearance: 0.4 }), { at: '5 5' }))
  assert.equal(errs(plain, 'clearance').length, 1)
  // by kind: the own pads keep the rules' 0.2, a track of C 0.3 away is held to 0.4
  const kinds = mk(
    {},
    h(
      Hdr()
        .connect(A, B)
        .rules({ clearance: { track: 0.4, zone: 0.4 } }),
      { at: '5 5' },
    ),
    under(C, 0.3),
  )
  const e = errs(kinds, 'clearance')
  assert.equal(e.length, 2, 'both pads are within 0.4 of the track')
  assert.match(e[0].message, /closer than 0\.4 mm \(part override of J1, to tracks\)/)
  assert.deepEqual(padOf(kinds, 'J1', 1).clearanceTo, { track: 0.4, zone: 0.4 })
  assert.equal(padOf(kinds, 'J1', 1).clearance, undefined)
  // a via or a pad of another part is not a track: the rules hold
  assert.deepEqual(
    errs(
      mk(
        {},
        h(
          Hdr()
            .connect(A, B)
            .rules({ clearance: { track: 0.4 } }),
          { at: '5 5' },
        ),
        under(C, 0.45),
      ),
      'clearance',
    ),
    [],
  )
  // self sets the clearance between the part's own pads
  const self = mk(
    {},
    h(
      Hdr()
        .connect(A, B)
        .rules({ clearance: { track: 0.4, self: 0.3 } }),
      { at: '5 5' },
    ),
  )
  assert.match(errs(self, 'clearance')[0].message, /closer than 0\.3 mm \(part override of J1, to its own pads\)/)
  assert.throws(() => Hdr().rules({ clearance: { tracks: 0.4 } }), /clearance has an unknown kind "tracks"; it takes pad, track, via, zone, text, self/)
  assert.throws(() => Hdr().rules({ clearance: {} }), /clearance must name a kind/)
})

test('kind clearance: pad over part, placement merged kind by kind over .rules()', () => {
  const { A, B, C } = nets()
  const P = Hdr()
    .connect(A, B)
    .rules({ clearance: { track: 0.4 } })
  const b = mk({}, h(P, { at: '5 5', rules: { clearance: { zone: 0.5 } }, p1: { clearance: { via: 0.3 } } }), under(C, 0.3))
  assert.deepEqual(padOf(b, 'J1', 1).clearanceTo, { via: 0.3 }, "the pad's own clearance wins whole")
  assert.deepEqual(padOf(b, 'J1', 2).clearanceTo, { track: 0.4, zone: 0.5 })
  assert.deepEqual(padOf(b, 'J1', 1).override, { clearance: 'pad' })
  assert.equal(errs(b, 'clearance').length, 1, 'only pad 2 holds the track to 0.4')
})

test('kind clearance: a class or a net scopes its tracks and vias, the larger of two overrides holds', () => {
  const { A, B, P, Q } = nets({ P: { class: 'power' } })
  const classes = { power: { width: 0.2, clearance: { track: 0.4 } } }
  // a power track 0.3 from a track of A
  const tt = mk({ classes }, line(P, 2, 2, 9), line(A, 2, 2.5, 9))
  assert.match(errs(tt, 'clearance')[0].message, /closer than 0\.4 mm \(class power, to tracks\)/)
  // a power track 0.3 from a pad: pads are not named, the rules hold
  assert.deepEqual(errs(mk({ classes }, h(Hdr().connect(A, B), { at: '5 5' }), under(P, 0.3)), 'clearance'), [])
  assert.equal(tt.classes.power.clearance, undefined)
  assert.deepEqual(tt.classes.power.clearanceTo, { track: 0.4 })
  // net.rules: the same, merged over the net's own class
  Q.rules({ clearance: { pad: 0.5 } })
  const nr = mk(
    {},
    h(
      Hdr()
        .connect(A, B)
        .rules({ clearance: { track: 0.4 } }),
      { at: '5 5' },
    ),
    under(Q, 0.45),
  )
  assert.equal(errs(nr, 'clearance').length, 2, "the net asks 0.5 of pads, over the part's 0.4 toward tracks")
  const pad = padOf(nr, 'J1', 1),
    t = nr.items.find(i => i.kind === 'track' && i.net === 'Q')
  assert.equal(itemClearance(nr, pad, t), 0.5)
  assert.equal(itemClearance(nr, t, pad), 0.5)
  assert.equal(overrideBetween(nr, padOf(nr, 'J1', 1), padOf(nr, 'J1', 2)), undefined, 'own pads: no override')
  assert.throws(() => mk({ classes: { power: { clearance: { self: 0.3 } } } }), /clearance has an unknown kind "self"/)
})

test('kind clearance: the router grows a pad by its override toward tracks, and not by one toward zones', () => {
  const { A, B } = nets()
  const P = defineFootprint(props => h('footprint', props, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'J' })
  const Big = defineFootprint(({ cl, ...props }) => h('footprint', props, h('pad', { num: 1, size: [1, 4], shape: 'rect', clearance: cl })), { pins: ['1'], prefix: 'K' })
  const run = cl =>
    compileBoard(
      h(
        PCB,
        { name: 'K', rules: R },
        edge(30, 10),
        h(P().connect(A), { at: '3 5' }),
        h(P().connect(A), { at: '27 5' }),
        h(Big({}).connect(B), { at: '15 5', cl }),
        h(P().connect(B), { at: '15 9' }),
        route('J1.1', 'J2.1'),
      ),
      opts,
    )
  const b = run({ track: 1, zone: 0.3 })
  assert.deepEqual(errs(b, 'clearance'), [])
  for (const t of b.items.filter(i => i.kind === 'track' && i.net === 'A'))
    for (const [x, y] of t.pts)
      assert.ok(Math.abs(x - 15) > 0.5 + 1 + t.width / 2 - 1e-6 || Math.abs(y - 5) > 2 + 1 + t.width / 2 - 1e-6, `track point ${x} ${y} keeps 1 mm from the pad`)
  const store = new ObstacleStore(b, b.rules, ['F.Cu', 'B.Cu']),
    big = padOf(b, 'K1', 1)
  assert.equal(store.gap(0, big.net, big), 1)
  const z = run({ zone: 1 })
  assert.equal(new ObstacleStore(z, z.rules, ['F.Cu', 'B.Cu']).gap(0, 'B', padOf(z, 'K1', 1)), 0.2, "toward zones only: the rules' clearance for a track")
  // a class scoped to pads grows every pad for its tracks; the count grids of such a class are its own
  const { C } = nets({ C: { class: 'hv' } })
  const c = compileBoard(
    h(PCB, { name: 'K', rules: R, classes: { hv: { clearance: { pad: 0.7 } } } }, edge(30, 10), h(P().connect(C), { at: '3 5' }), h(P().connect(A), { at: '8 5' })),
    opts,
  )
  const s = new ObstacleStore(c, c.rules, ['F.Cu', 'B.Cu'])
  assert.equal(s.gap(0, 'A', padOf(c, 'J2', 1), 'C'), 0.7)
  assert.equal(s.gap(0, 'A', padOf(c, 'J2', 1), 'A'), 0.2)
  assert.equal(s.scopeOf('C'), 'hv')
  assert.equal(s.scopeOf('A'), '')
})

test('kind clearance: the zone fill keeps a pad override toward zones, and not one toward tracks', () => {
  const { A, B } = nets()
  const Big = defineFootprint(({ cl, ...props }) => h('footprint', props, h('pad', { num: 1, size: [1, 4], shape: 'rect', clearance: cl })), { pins: ['1'], prefix: 'K' })
  const P = defineFootprint(props => h('footprint', props, h('pad', { num: 1, size: 1 })), { pins: ['1'], prefix: 'J' })
  const fillOf = cl => {
    const z = compileBoard(
      h(
        PCB,
        { name: 'K', rules: R },
        edge(30, 10),
        h(Big({}).connect(B), { at: '15 5', cl }),
        h(P().connect(B), { at: '15 9' }),
        pour(A, 'F.Cu', 'M0 0 H30 V10 H0 Z', { islands: 'keep' }),
      ),
      opts,
    )
    assert.deepEqual(errs(z, 'clearance'), [])
    const fill = polysToRings(z.items.find(i => i.kind === 'zone').fill)
    return (x, y) =>
      polysToRings(
        intersection(fill, [
          [
            [x - 0.01, y - 0.01],
            [x + 0.01, y - 0.01],
            [x + 0.01, y + 0.01],
            [x - 0.01, y + 0.01],
          ],
        ]),
      ).length > 0
  }
  const zone = fillOf({ zone: 1, track: 0.2 })
  assert.ok(!zone(15.5 + 0.9, 5), 'no fill within 1 mm of the pad')
  assert.ok(zone(15.5 + 1.2, 5))
  const track = fillOf({ track: 1 })
  assert.ok(track(15.5 + 0.4, 5), "the pour keeps the rules' clearance only")
})

test('kind clearance: tsc takes the pad type form on a class and a net, and holeClearance by side with via', async () => {
  const ts = (await import('typescript')).default
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const core = new URL(import.meta.resolve('@pcbjs/core')).pathname
  const dir = mkdtempSync(join(tmpdir(), 'pcbjs-kinds-'))
  const lines = [
    `import { nets, type NetClass, type Rules } from ${JSON.stringify(core)}`,
    `export const power: NetClass = { clearance: { pad: { tht: 0.5, smd: 0.2 }, track: 0.3 } }`,
    `export const { GND } = nets()`,
    `GND.rules({ clearance: { pad: { tht: 0.4 } } })`,
    `export const r: Partial<Rules> = { holeClearance: { outer: 0.28, inner: 0.33, via: 0.2 } }`,
    `// @ts-expect-error self is a part's clearance, not a class's`,
    `export const bad: NetClass = { clearance: { self: 0.2 } }`,
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

test('kind clearance: holeClearance via holds from a via hole, pad holes keep the layer side', () => {
  const { A, B } = nets()
  // a 0.3 drill 0.6 via, its hole edge 0.25 from a 0.2 track of B: copper 0.05 apart is not checked here, the hole is
  const rules = { clearance: 0.04, edgeClearance: 0.4, holeClearance: 0.28 }
  const via = h('via', { net: A, at: '5 5', drill: 0.3, size: 0.4 })
  const track = line(B, 2, 5 + 0.15 + 0.25 + 0.1, 9)
  const plain = compileBoard(h(PCB, { name: 'V', rules }, edge(), via, track), opts)
  assert.equal(errs(plain, 'hole-to-copper').length, 1)
  const by = compileBoard(h(PCB, { name: 'V', rules: { ...rules, holeClearance: { via: 0.2 } } }, edge(), via, track), opts)
  assert.deepEqual(errs(by, 'hole-to-copper'), [])
  assert.deepEqual(by.rules.holeClearanceBy, { inner: 0.3, outer: 0.3, via: 0.2 }, 'the sides over the default 0.3')
  assert.equal(by.rules.holeClearance, 0.3)
  const tight = compileBoard(h(PCB, { name: 'V', rules: { ...rules, holeClearance: { via: 0.3 } } }, edge(), via, track), opts)
  assert.match(errs(tight, 'hole-to-copper')[0].message, /closer than 0\.3 mm \(via hole\)/)
})
