// The solder mask web rule, `rules.maskWeb`: the DRC warning mask-web on the openings the Gerber writer draws, one finding per
// part for pads of one part, one per pair across parts, none where the openings merge or a mask drawing gangs them; and the
// courtyard tolerance, an overlap under 10 µm passing as KiCad passes it.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, nets, defineFootprint, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '../dist/index.js'
import { maskOpenings, padMask } from '../dist/mask.js'

afterEach(() => resetDefaults())

const outline = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 30, h: 20 })
const mk = (rules, ...kids) => compileBoard(h(PCB, { name: 'M', rules: { clearance: 0.1, minTrackWidth: 0.1, ...rules } }, outline(), ...kids), { routeCache: false })
const find = (b, rule) => b.drc.filter(d => d.rule === rule)
/** four 0.25 by 1 mm pads at 0.5 mm pitch: 0.25 mm of copper between pads, 0.15 mm of mask with the 0.05 expansion */
const pads = () => [0, 1, 2, 3].map(k => h('pad', { num: k + 1, at: `${(k - 1.5) * 0.5} 0`, size: [0.25, 1], shape: 'rect' }))
const Row = defineFootprint(props => h('footprint', props, ...pads()), { pins: ['1', '2', '3', '4'], prefix: 'U' })
/** the same row with a gang opening drawn on F.Mask over it */
const Ganged = defineFootprint(props => h('footprint', props, ...pads(), h('rect', { layer: 'F.Mask', x: -1, y: -0.6, w: 2, h: 1.2, fill: true })), { pins: ['1', '2', '3', '4'], prefix: 'U' })

test('mask-web: pads of one part are one finding naming the narrowest pair, the web and the count', () => {
  const { A, B, C, D } = nets()
  const b = mk({ maskWeb: 0.2 }, h(Row().connect(A, B, C, D), { at: '10 10', ref: false }))
  const w = find(b, 'mask-web')
  assert.equal(w.length, 1)
  assert.equal(w[0].severity, 'warning')
  assert.equal(w[0].layer, 'F.Mask')
  assert.match(w[0].message, /^mask web between pad U1\.\d and pad U1\.\d on F\.Mask is 0\.15 mm, narrower than 0\.2 mm, and 2 more pairs of U1; the fab merges the openings$/)
  // at the web or below the rule, and without the rule, nothing
  assert.deepEqual(find(mk({ maskWeb: 0.15 }, h(Row().connect(A, B, C, D), { at: '10 10', ref: false })), 'mask-web'), [])
  assert.deepEqual(find(mk({}, h(Row().connect(A, B, C, D), { at: '10 10', ref: false })), 'mask-web'), [])
})

test('mask-web: pads of two parts are one finding per pair', () => {
  const { A, B, C, D, E, F, G, H } = nets()
  // U2's pad 1 sits 0.5 mm right of U1's pad 4: the same 0.15 mm web across the parts
  const b = mk({ maskWeb: 0.2 }, h(Row().connect(A, B, C, D), { at: '10 10', ref: false }), h(Row().connect(E, F, G, H), { at: '12 10', ref: false }))
  const msgs = find(b, 'mask-web').map(d => d.message)
  assert.equal(msgs.length, 3)
  assert.ok(msgs.some(m => /^mask web between pad U1\.4 and pad U2\.1 on F\.Mask is 0\.15 mm, narrower than 0\.2 mm; the fab merges the openings$/.test(m)), msgs.join('\n'))
})

test('mask-web: openings that merge, and pads a mask drawing gangs, pass', () => {
  const { A, B, C, D } = nets()
  // a 0.15 mm expansion makes the openings overlap: one merged opening, no web
  assert.deepEqual(find(mk({ maskWeb: 0.2, maskExpansion: 0.15 }, h(Row().connect(A, B, C, D), { at: '10 10', ref: false })), 'mask-web'), [])
  // a filled rect on F.Mask over the row opens the mask across it on purpose
  const b = mk({ maskWeb: 0.2 }, h(Ganged().connect(A, B, C, D), { at: '10 10', ref: false }))
  assert.deepEqual(find(b, 'mask-web'), [])
})

test('mask-web: DRC measures the openings the mask Gerber draws', () => {
  const { A, B, C, D } = nets()
  const b = mk({ maskWeb: 0.2 }, h(Row().connect(A, B, C, D), { at: '10 10', ref: false }))
  const pads = b.items.filter(it => it.kind === 'pad')
  assert.deepEqual(maskOpenings(b, 'F'), pads.flatMap(p => padMask(p, 'F', b.rules) ?? []))
  assert.deepEqual(maskOpenings(b, 'B'), [])
})

test('mask-web: the rule is checked like the others', () => {
  assert.throws(() => mk({ maskWeb: -1 }), /maskWeb must be a number of mm/)
})

/** a 2 by 2 mm courtyard about the origin and one pad */
const Box = defineFootprint(props => h('footprint', props, h('pad', { num: 1, at: '0 0', size: 0.5 }),
  h('rect', { layer: 'F.CrtYd', x: -1, y: -1, w: 2, h: 2, width: 0.05 })), { pins: ['1'], prefix: 'C' })

test('courtyard: an overlap under 10 µm passes, a deeper one is a warning', () => {
  const { A, B } = nets()
  const pair = gap => mk({}, h(Box().connect(A), { at: '10 10', ref: false }), h(Box().connect(B), { at: `${12 - gap} 10`, ref: false }))
  assert.deepEqual(find(pair(0.005), 'courtyard'), [], '5 µm deep')
  const w = find(pair(0.05), 'courtyard')
  assert.equal(w.length, 1, '50 µm deep')
  assert.match(w[0].message, /^courtyards of C1 and C2 overlap$/)
})
