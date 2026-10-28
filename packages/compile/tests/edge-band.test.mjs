// The edge band rule: courtyards, silk and pads kept out of a band along the outline, `rules.edge`, with parts and pads let in
// by `except`, and the findings edge-courtyard, edge-silk and edge-pad naming the item and its distance to the edge.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, defineFootprint, resetDefaults, defineDefaultRules } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'

afterEach(() => resetDefaults())

const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const mk = (rules, ...kids) => compileBoard(h(PCB, { name: 'E', rules: { edgeClearance: 0.3, ...rules } }, outline(), ...kids), { routeCache: false })
const find = (b, rule) => b.drc.filter(d => d.rule === rule)
/** two 1 mm pads 2 mm apart, a courtyard 4 by 2 mm about the origin and a silk line under it */
const Two = defineFootprint(
  props =>
    h(
      'footprint',
      props,
      h('pad', { num: 1, at: '-1 0', size: 1, shape: 'rect' }),
      h('pad', { num: 2, at: '1 0', size: 1, shape: 'rect' }),
      h('rect', { layer: 'F.CrtYd', x: -2, y: -1, w: 4, h: 2, width: 0.05 }),
      h('path', { layer: 'F.SilkS', d: 'M-0.5 1.3 H0.5', width: 0.15 }),
    ),
  { pins: ['1', '2'], prefix: 'J' },
)

test('edge band: courtyards, silk and pads in the band are errors naming the distance', () => {
  const { A, B, C, D } = nets()
  // J1 at x = 2.5: its courtyard reaches x = 0.5, its pad 1 x = 1, both inside a 1.2 mm band; J2 sits in the middle
  const J1 = Two().connect(A, B),
    J2 = Two().connect(C, D)
  const b = mk({ edge: { width: 1.2 } }, h(J1, { at: '2.5 10', ref: false }), h(J2, { at: '15 10', ref: false }))
  const cy = find(b, 'edge-courtyard')
  assert.equal(cy.length, 1)
  assert.equal(cy[0].severity, 'error')
  assert.match(cy[0].message, /^courtyard of J1 is 0\.5 mm from the board edge, inside the 1\.2 mm edge band$/)
  const pads = find(b, 'edge-pad')
  assert.deepEqual(
    pads.map(p => p.message),
    ['pad J1.1 is 1 mm from the board edge, inside the 1.2 mm edge band'],
  )
  assert.deepEqual(find(b, 'edge-silk'), [], 'the silk line runs from x = 1 inward')
  // nothing without the rule
  assert.deepEqual(
    mk({}, h(Two().connect(A, B), { at: '2.5 10', ref: false }))
      .drc.filter(d => d.rule.startsWith('edge-'))
      .map(d => d.rule),
    [],
  )
})

test('edge band: kinds narrow the check, except lets a part or one pad in', () => {
  const { A, B } = nets()
  const J1 = Two().connect(A, B)
  const at = { at: '2.5 10', ref: false }
  const rules = kids =>
    mk({ edge: { width: 1.2, ...kids } }, h(J1, at))
      .drc.filter(d => d.rule.startsWith('edge-'))
      .map(d => d.rule)
  assert.deepEqual(rules({ kinds: ['pad'] }), ['edge-pad'])
  assert.deepEqual(rules({ except: [J1] }), [])
  assert.deepEqual(rules({ except: ['J1'] }), [])
  assert.deepEqual(rules({ except: [J1.pad(1)] }), ['edge-courtyard'])
  assert.deepEqual(rules({ except: [J1[1]] }), ['edge-courtyard'], 'a pin handle lets its pads in')
  assert.deepEqual(rules({ except: ['J1.1'] }), ['edge-courtyard'])
  assert.throws(() => rules({ except: ['J9'] }), /edge\.except names "J9", which is no part or pad on this board/)
  assert.throws(() => rules({ kinds: ['body'] }), /edge\.kinds must list 'courtyard', 'silk', 'pad'/)
  assert.throws(() => mk({ edge: { kinds: ['pad'] } }), /edge needs a width/)
})

test('edge band: silk past the band, and the band around a cutout', () => {
  const b = mk(
    { edge: { width: 1, kinds: ['silk'] } },
    h('text', { layer: 'F.SilkS', at: '15 0.9', size: 1, children: 'TOP' }),
    h('circle', { layer: 'Edge.Cuts', cx: 15, cy: 10, r: 2 }),
    h('path', { layer: 'F.SilkS', d: 'M10 10 H12.5', width: 0.2 }),
    h('path', { layer: 'B.SilkS', d: 'M20 19.3 H24', width: 0.2 }),
    h('path', { layer: 'B.SilkS', d: 'M20 18.8 H24', width: 0.2 }),
  )
  const silk = find(b, 'edge-silk').map(d => d.message)
  assert.equal(silk.length, 3)
  assert.match(silk[0], /^text "TOP" on F\.SilkS (crosses the board edge|is [\d.]+ mm from the board edge), inside the 1 mm edge band$/)
  assert.match(silk[1], /^silk graphic on F\.SilkS is 0\.4\d* mm from the board edge, inside the 1 mm edge band$/, 'the band runs round the cutout')
  assert.equal(silk[2], 'silk graphic on B.SilkS is 0.6 mm from the board edge, inside the 1 mm edge band')
})

test('edge band: merged key by key from the default rules, the board adding except', () => {
  const { A, B } = nets()
  const J1 = Two().connect(A, B)
  defineDefaultRules({ edge: { width: 1.2, kinds: ['courtyard', 'pad'] } })
  const b = mk({ edge: { except: [J1.pad(1)] } }, h(J1, { at: '2.5 10', ref: false }))
  assert.deepEqual(b.rules.edge, { width: 1.2, kinds: ['courtyard', 'pad'], except: ['J1.1'] })
  assert.deepEqual(
    b.drc.filter(d => d.rule.startsWith('edge-')).map(d => d.rule),
    ['edge-courtyard'],
  )
})
