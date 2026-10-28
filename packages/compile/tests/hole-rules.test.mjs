// Hole rules by layer and kind: `holeClearance: { inner, outer }` for hole to copper, `minHoleToHole: { pad, via }` for hole to
// hole, a number meaning both, merged side by side over a lower level, the router keeping the larger side.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, resetDefaults, defineDefaultRules } from '@pcbjs/core'
import { resolveRules, holeClearanceOn, holeToHole } from '@pcbjs/core/rules'
import { compileBoard } from '../dist/index.js'

afterEach(() => resetDefaults())

const mk = (rules, ...kids) => compileBoard(h(PCB, { name: 'H', copper: 4, rules }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 }), ...kids), { routeCache: false })
const find = (b, rule) => b.drc.filter(d => d.rule === rule)
/** a 1 mm non-plated hole at x, y */
const hole = (x, y, ref) => h('footprint', { ref, at: `${x} ${y}` }, h('pad', { num: '', at: '0 0', size: 1, drill: 1, type: 'npth' }))
/** a 0.2 mm track on a layer whose edge is `gap` from the edge of a 1 mm hole at 10 10 */
const by = (layer, gap) => h('track', { net: 'B', layer, width: 0.2, d: `M5 ${10 + 0.5 + gap + 0.1} H15` })

test('hole rules: hole to copper by layer, outer on F.Cu and B.Cu, inner between', () => {
  const rules = { holeClearance: { inner: 0.33, outer: 0.28 } }
  const b = mk(rules, hole(10, 10, 'H1'), by('F.Cu', 0.3), by('In1.Cu', 0.3))
  const f = find(b, 'hole-to-copper')
  assert.equal(f.length, 1)
  assert.equal(f[0].layer, 'In1.Cu')
  assert.match(f[0].message, /closer than 0\.33 mm \(inner layers\)$/)
  assert.equal(b.rules.holeClearance, 0.33, 'the router keeps the larger side')
  assert.deepEqual(b.rules.holeClearanceBy, { inner: 0.33, outer: 0.28 })
  // a number holds on every layer
  assert.equal(find(mk({ holeClearance: 0.33 }, hole(10, 10, 'H1'), by('F.Cu', 0.3), by('In1.Cu', 0.3)), 'hole-to-copper').length, 2)
  assert.throws(() => mk({ holeClearance: { top: 0.3 } }), /holeClearance must be a number of mm or \{ inner, outer, via \} of mm/)
})

test('hole rules: the pour keeps the hole clearance of its layer', () => {
  const pour = layer => h('zone', { net: 'GND', layer, d: 'M0 0 H30 V20 H0 Z', islands: 'keep' })
  const b = mk({ holeClearance: { inner: 0.6, outer: 0.3 } }, hole(10, 10, 'H1'), pour('F.Cu'), pour('In1.Cu'))
  const reach = layer => {
    const z = b.items.find(i => i.kind === 'zone' && i.layer === layer)
    // the nearest fill vertex to the hole centre, less the hole radius
    return Math.min(...z.fill.flatMap(p => p.holes.flat()).map(([x, y]) => Math.hypot(x - 10, y - 10))) - 0.5
  }
  assert.ok(reach('F.Cu') > 0.3 && reach('F.Cu') < 0.4, `F.Cu ${reach('F.Cu')}`)
  assert.ok(reach('In1.Cu') > 0.6 && reach('In1.Cu') < 0.7, `In1.Cu ${reach('In1.Cu')}`)
  assert.deepEqual(find(b, 'hole-to-copper'), [])
})

test('hole rules: hole to hole by kind, via between two vias, pad otherwise', () => {
  const via = (x, net = 'A') => h('via', { at: `${x} 5`, net, drill: 0.3, size: 0.6 })
  const rules = { minHoleToHole: { pad: 0.45, via: 0.2 } }
  // two vias 0.3 mm apart edge to edge, two holes 0.3 mm apart, a via 0.3 mm from a hole
  const b = mk(rules, via(5), via(5.6), hole(10, 10, 'H1'), hole(11.3, 10, 'H2'), via(20), hole(20.95, 5, 'H3'))
  const f = find(b, 'hole-to-hole').map(d => d.message)
  assert.deepEqual(
    f,
    [
      'holes of unplated hole of H1 at (10, 10) and unplated hole of H2 at (11.3, 10) are 0.3 mm apart edge to edge, minimum 0.45 mm (pad)',
      'holes of via A and unplated hole of H3 at (20.95, 5) are 0.3 mm apart edge to edge, minimum 0.45 mm (pad)',
    ],
    'the two vias keep 0.2',
  )
  assert.equal(find(mk({ minHoleToHole: 0.45 }, via(5), via(5.6)), 'hole-to-hole').length, 1, 'a number holds between vias too')
})

test('hole rules: side by side over a lower level, and the helpers', () => {
  defineDefaultRules({ holeClearance: 0.3, minHoleToHole: { via: 0.25 } })
  const b = mk({ holeClearance: { inner: 0.4 } })
  assert.deepEqual(b.rules.holeClearanceBy, { inner: 0.4, outer: 0.3 })
  assert.deepEqual(b.rules.minHoleToHoleBy, { pad: 0.5, via: 0.25 }, 'pad keeps BASE 0.5')
  assert.equal(b.rules.minHoleToHole, 0.5)
  const r = resolveRules({ ...b.rules, holeClearance: { inner: 0.33, outer: 0.28 }, minHoleToHole: 0.4 })
  assert.equal(holeClearanceOn(r, 'B.Cu'), 0.28)
  assert.equal(holeClearanceOn(r, 'In2.Cu'), 0.33)
  assert.equal(holeToHole(r, 'via', 'via'), 0.4)
  assert.equal(r.minHoleToHoleBy, undefined)
})

test('hole rules: JLCPCB states hole to hole by kind, pad 0.45 and via to via 0.2', async () => {
  const { JLCPCB } = await import('@pcbjs/lib/rules')
  assert.deepEqual(JLCPCB.minHoleToHole, { pad: 0.45, via: 0.2 })
  const r = resolveRules(JLCPCB)
  assert.equal(r.minHoleToHole, 0.45, 'the router keeps 0.45 as before')
  assert.deepEqual(r.minHoleToHoleBy, { pad: 0.45, via: 0.2 })
})
