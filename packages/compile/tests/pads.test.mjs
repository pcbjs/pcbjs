import { test } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, pour, part, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { area, bbox, intersection, polysToRings } from '../dist/geom.js'
import { near } from './helpers.mjs'

const outline = (w = 20, hh = 20) => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w, h: hh })
const board = (props, ...kids) => {
  resetDefaults()
  return compileBoard(h(PCB, { name: 'P', ...props }, outline(), ...kids), { routeCache: false })
}
const errs = (b, rule) => b.drc.filter(d => d.rule === rule)
const padOf = (b, num, ref = 'U1') => b.items.find(i => i.kind === 'pad' && i.ref === ref && i.num === String(num))
const zoneOf = b => b.items.find(i => i.kind === 'zone')
const sq = (x, y, r = 0.02) => [
  [x - r, y - r],
  [x + r, y - r],
  [x + r, y + r],
  [x - r, y + r],
]
const covered = (b, x, y) => polysToRings(intersection(polysToRings(zoneOf(b).fill), [sq(x, y)])).length > 0

test('clearance: a pad or part override is the clearance of every pair the pad is in, the rules and classes aside', () => {
  const fp = (props, pad = {}) => h('footprint', { ref: 'U1', at: '10 10', 'net:1': 'SIG', ...props }, h('pad', { num: 1, size: [1, 1], shape: 'rect', ...pad }))
  const track = h('track', { net: 'GND', layer: 'F.Cu', width: 0.2, d: 'M10.77 5 L10.77 15' })
  const rules = { clearance: 0.2 }
  assert.equal(errs(board({ rules }, fp({}), track), 'clearance').length, 1, 'without an override the rules hold')
  assert.deepEqual(errs(board({ rules }, fp({ rules: { clearance: 0.15 } }), track), 'clearance'), [], 'the part override holds')
  assert.deepEqual(errs(board({ rules }, fp({}, { clearance: 0.15 }), track), 'clearance'), [], 'the pad override holds')
  // a class asking more on the track's net does not count against the override
  const { GND } = nets({ GND: { class: 'power' } })
  const classed = board(
    { rules, classes: { power: { clearance: 0.3 } } },
    fp({ rules: { clearance: 0.15 } }),
    h('track', { net: GND, layer: 'F.Cu', width: 0.2, d: 'M10.77 5 L10.77 15' }),
  )
  assert.deepEqual(
    errs(classed, 'clearance').filter(e => /U1/.test(e.message)),
    [],
  )
  // an override above the rules still holds, named in the finding
  const big = errs(board({ rules }, fp({ rules: { clearance: 0.25 } }), track), 'clearance')
  assert.equal(big.length, 1)
  assert.match(big[0].message, /closer than 0\.25 mm \(part override of U1\)/)
  // the pour comes to the override, not to the rules
  const fill = board(
    { rules: { ...rules, zoneMinWidth: 0.1 } },
    fp({}, { clearance: 0.1 }),
    h('footprint', { ref: 'U2', at: '3 3', 'net:1': 'GND' }, h('pad', { num: 1, size: 1 })),
    pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z'),
  )
  assert.ok(covered(fill, 10.5 + 0.15, 10), 'fill 0.15 mm from the pad')
  assert.deepEqual(errs(fill, 'clearance'), [])
})

test('zone fill: the fill margin widens the clearance only, so a strip at the min width stays', () => {
  // a 0.263 mm strip between two tracks, pour clearance 0.205, minWidth 0.25
  const kids = minWidth => [
    h('footprint', { ref: 'U1', at: '3 15', 'net:1': 'GND' }, h('pad', { num: 1, size: 1 })),
    h('track', { net: 'A', layer: 'F.Cu', width: 0.254, d: 'M3 4.6 L17 4.6' }),
    h('track', { net: 'B', layer: 'F.Cu', width: 0.4, d: 'M3 5.6 L17 5.6' }),
    pour('GND', 'F.Cu', 'M0 0 H20 V20 H0 Z', { clearance: 0.205, minWidth }),
  ]
  const mid = (4.6 + 0.127 + 5.6 - 0.2) / 2
  assert.ok(covered(board({}, ...kids(0.25)), 10, mid), 'the strip is filled at minWidth 0.25')
  assert.ok(!covered(board({}, ...kids(0.3)), 10, mid), 'and gone at 0.3')
  assert.deepEqual(errs(board({}, ...kids(0.25)), 'clearance'), [])
})

test('paste: ratio, own shrink, custom windows, a window grid and none', () => {
  const fp = pad => board({}, h('footprint', { ref: 'U1', at: '10 10' }, h('pad', { num: 1, size: [2, 1], shape: 'rect', ...pad })))
  assert.equal(padOf(fp({}), 1).pasteRings, undefined, 'the plain pad leaves its paste to the exporters')
  const ratio = padOf(fp({ pasteRatio: -0.1 }), 1)
  const rb = bbox(ratio.pasteRings)
  near(rb.w, 1.6, 1e-9)
  near(rb.h, 0.8, 1e-9)
  near(rb.x, 9.2, 1e-9)
  assert.equal(ratio.pasteRatio, -0.1)
  const both = bbox(padOf(fp({ pasteRatio: -0.1, pasteShrink: 0.05 }), 1).pasteRings)
  near(both.w, 1.5, 1e-9)
  near(both.h, 0.7, 1e-9)
  // custom windows in the pad frame, turned with the pad
  const custom = padOf(
    board(
      {},
      h(
        'footprint',
        { ref: 'U1', at: '10 10 90' },
        h('pad', {
          num: 1,
          size: [2, 1],
          paste: [
            [
              [-0.5, -0.25],
              [0.5, -0.25],
              [0.5, 0.25],
              [-0.5, 0.25],
            ],
          ],
        }),
      ),
    ),
    1,
  )
  const cb = bbox(custom.pasteRings)
  near(cb.w, 0.5, 1e-9)
  near(cb.h, 1, 1e-9)
  // an exposed pad: a 3 by 2 grid holding 60 % of the pad
  const ep = padOf(board({}, h('footprint', { ref: 'U1', at: '10 10' }, h('pad', { num: 1, size: [3, 2], shape: 'rect', paste: { rows: 2, cols: 3, coverage: 0.6 } }))), 1)
  assert.equal(ep.pasteRings.length, 6)
  near(Math.abs(area(ep.pasteRings)), 0.6 * 6, 1e-4)
  const rr = padOf(board({}, h('footprint', { ref: 'U1', at: '10 10' }, h('pad', { num: 1, size: 3, paste: { rows: 2, cols: 2 } }))), 1)
  assert.equal(rr.pasteRings.length, 4)
  assert.ok(Math.abs(area(rr.pasteRings)) <= 0.5 * 9 + 1e-6, 'coverage 0.5 by default, cut to the rounded corners')
  const none = padOf(fp({ paste: false }), 1)
  assert.equal(none.paste, false)
  assert.equal(none.pasteRings, undefined)
  assert.throws(() => fp({ paste: { rows: 0, cols: 2 } }), /<pad 1> paste windows need whole rows and cols/)
  assert.throws(() => fp({ paste: { rows: 1, cols: 1, coverage: 2 } }), /coverage must be above 0 and at most 1/)
  assert.throws(() => fp({ pasteRatio: -0.6 }), /pasteRatio must be a number above -0.5/)
})

test('mask: a non-plated hole opens the mask on both sides, as KiCad does, unless mask is false', () => {
  const hole = pad => padOf(board({}, h('footprint', { ref: 'H1', at: '10 10' }, h('pad', { num: '', type: 'npth', size: 1.152, drill: 1.152, ...pad }))), '', 'H1')
  const m = hole({ maskExpansion: 0.148 })
  assert.deepEqual(m.layers, ['F.Mask', 'B.Mask'])
  const b = bbox(m.maskRings)
  near(b.w, 1.152 + 2 * 0.148, 0.01)
  const plain = hole({})
  assert.deepEqual(plain.layers, ['F.Mask', 'B.Mask'], 'a bare hole as large as its pad opens the mask too')
  near(bbox(plain.maskRings).w, 1.152 + 2 * 0.05, 0.01)
  const none = hole({ mask: false })
  assert.equal(none.maskRings, undefined)
  assert.deepEqual(none.layers, [])
  assert.ok(hole({ size: 2 }).maskRings, 'a pad larger than the drill')
})

test('through-hole pad on fewer copper layers: the barrel joins them, the hole keeps its clearance on every layer', () => {
  const stack = { copper: 4 }
  const tht = (net = 'A') => h('footprint', { ref: 'U1', at: '10 10', 'net:1': net }, h('pad', { num: 1, size: 1.6, drill: 0.8, layers: ['F.Cu', 'B.Cu'] }))
  const ends = h('footprint', { ref: 'U2', at: '3 3', 'net:1': 'A', 'net:2': 'A' }, h('pad', { num: 1, size: 1 }), h('pad', { num: 2, at: '14 0', size: 1, layers: ['B.Cu'] }))
  const tracks = [h('track', { net: 'A', layer: 'F.Cu', width: 0.3, d: 'M3 3 L10 10' }), h('track', { net: 'A', layer: 'B.Cu', width: 0.3, d: 'M10 10 L17 3' })]
  const b = board(stack, tht(), ends, ...tracks)
  assert.deepEqual(padOf(b, 1).layers, ['F.Cu', 'B.Cu'])
  assert.equal(b.unconnected, 0, 'F.Cu to B.Cu through the barrel')
  // an In1.Cu track of another net 0.1 mm from the hole edge, clear of where a ring would be
  const near1 = board(stack, tht(), ends, ...tracks, h('track', { net: 'B', layer: 'In1.Cu', width: 0.2, d: 'M10.6 5 L10.6 15' }))
  const e = errs(near1, 'hole-to-copper')
  assert.equal(e.length, 1)
  assert.equal(e[0].layer, 'In1.Cu')
  assert.deepEqual(errs(near1, 'clearance'), [], 'no ring on In1.Cu to keep clear of')
  // a pour of the pad's own net on In1.Cu clears the hole there, since the pad has no ring to join
  const z = board(stack, tht(), ends, ...tracks, h('via', { net: 'A', at: '15 15' }), pour('A', 'In1.Cu', 'M0 0 H20 V20 H0 Z'))
  assert.ok(!covered(z, 10.5, 10) && covered(z, 10 + 0.4 + 0.5, 10))
})

test('dnp: out of the BOM and the placement file, still on the board and in the DRC', () => {
  const Fp = props => h('footprint', props, h('pad', { num: 1, size: 1 }), h('pad', { num: 2, at: '1.15 0', size: 1 }))
  Fp.pins = ['1', '2']
  Fp.prefix = 'R'
  const b = board({}, h('footprint', { ref: 'U1', at: '5 5', dnp: true }, h('pad', { num: 1, size: 1 })))
  assert.deepEqual([b.footprints[0].dnp, b.footprints[0].bom, b.footprints[0].pos], [true, false, false])
  assert.equal(b.items.filter(i => i.kind === 'pad').length, 1)
  resetDefaults()
  const { A, B, C, D, E, F } = nets()
  const R = part(Fp, { value: '1k', dnp: true })
  const S = part(Fp, { value: '2k' })
  const c = compileBoard(
    h(PCB, { name: 'P' }, outline(), h(R.connect(A, B), { at: '5 5' }), h(S.connect(C, D), { at: '5 10', dnp: true }), h(part(Fp, { value: '3k' }).connect(E, F), { at: '10 10' })),
    { routeCache: false },
  )
  assert.deepEqual(
    c.footprints.map(f => [f.value, !!f.dnp, f.bom]),
    [
      ['1k', true, false],
      ['2k', true, false],
      ['3k', false, true],
    ],
  )
  assert.ok(errs(c, 'clearance').length >= 2, 'its pads are still checked')
  assert.throws(() => board({}, h('footprint', { ref: 'U1', dnp: 'yes' })), /U1: dnp must be true or false/)
})
