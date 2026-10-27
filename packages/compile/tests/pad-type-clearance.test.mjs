// Clearance toward pads by their type, `clearance: { pad: { tht, smd } }` on a class, a net or a part, as KiCad's rules on
// Pad_Type: resolved in itemClearance, a number still holding toward both types and a non-plated hole toward neither.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, defineFootprint, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { itemClearance } from '../dist/netclass.js'

afterEach(() => resetDefaults())

const mk = (props, ...kids) => compileBoard(h(PCB, { name: 'T', rules: { clearance: 0.2 }, ...props }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 }), ...kids), { routeCache: false })
const errs = b => b.drc.filter(d => d.rule === 'clearance')
/** a through-hole pad at x = 0 and an SMD pad at x = 10, both 1 mm square */
const Mixed = defineFootprint(props => h('footprint', props,
  h('pad', { num: 1, at: '0 0', size: 1, shape: 'rect', drill: 0.5 }), h('pad', { num: 2, at: '10 0', size: 1, shape: 'rect' })), { pins: ['1', '2'], prefix: 'J' })
/** a 0.2 mm track of net n under both pads, `gap` from their edges */
const under = (n, gap) => h('track', { net: n, layer: 'F.Cu', width: 0.2, d: `M3 ${10.5 + gap + 0.1} H17` })

test('pad type clearance: a class holds its tracks to through-hole pads apart from SMD pads', () => {
  const { A, B, P } = nets({ P: { class: 'power' } })
  const classes = c => ({ power: { clearance: c } })
  const J1 = () => Mixed().connect(A, B)
  // 0.3 mm from both pads: tht 0.5 is broken, smd 0.2 holds
  const b = mk({ classes: classes({ pad: { tht: 0.5, smd: 0.2 } }) }, h(J1(), { at: '5 10', ref: false }), under(P, 0.3))
  assert.deepEqual(errs(b).map(e => e.message.replace(/ on F\.Cu.*?closer/, ' closer')), ['pad J1.1 (A) is 0.3 mm from track P (P) closer than 0.5 mm (class power, to tht pads)'])
  // a number holds toward both
  assert.equal(errs(mk({ classes: classes({ pad: 0.5 }) }, h(J1(), { at: '5 10', ref: false }), under(P, 0.3))).length, 2)
  // a type left out keeps the rules'
  assert.equal(errs(mk({ classes: classes({ pad: { smd: 0.4 } }) }, h(J1(), { at: '5 10', ref: false }), under(P, 0.3))).length, 1)
  assert.throws(() => mk({ classes: classes({ pad: { npth: 0.5 } }) }), /clearance pad has an unknown pad type "npth"; it takes tht, smd/)
  assert.throws(() => mk({ classes: classes({ pad: {} }) }), /clearance pad must name a pad type/)
})

test('pad type clearance: a part override toward other parts\' pads, by their type', () => {
  const { A, B, C, D } = nets()
  const J1 = Mixed().connect(A, B), J2 = Mixed().connect(C, D).rules({ clearance: { pad: { tht: 0.6 } } })
  // J2 one row below J1, its pads 0.4 mm from J1's: tht to tht 0.6 breaks, J2's SMD pad toward J1's SMD pad keeps the rules' 0.2
  const b = mk({}, h(J1, { at: '5 5', ref: false }), h(J2, { at: '5 6.4', ref: false }))
  assert.deepEqual(errs(b).map(e => e.layer), ['F.Cu', 'B.Cu'], 'the two through-hole pads, on each layer')
  assert.ok(errs(b).every(e => /^pad J1\.1 \(A\) is 0\.4 mm from pad J2\.1/.test(e.message)))
  assert.match(errs(b)[0].message, /closer than 0\.6 mm \(part override of J2, to tht pads\)/)
  const pad = (ref, num) => b.items.find(i => i.kind === 'pad' && i.ref === ref && i.num === num)
  assert.equal(itemClearance(b, pad('J2', '2'), pad('J1', '1')), 0.6, 'toward a through-hole pad whatever its own type')
  assert.equal(itemClearance(b, pad('J2', '1'), pad('J1', '2')), 0.2)
  assert.equal(itemClearance(b, pad('J2', '1'), { kind: 'pad', type: 'npth', ref: 'H1' }), 0.2, 'a non-plated hole is neither type')
})
