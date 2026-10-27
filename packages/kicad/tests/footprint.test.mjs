// readFootprint and kicadFootprint: KiCad library footprints of every pad shape compiled on a pcbjs board, front and back,
// with each pad at the position, rotation and size KiCad gives it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { defineFootprint } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { parseSExpr, readFootprint, readKicadMod, kicadFootprint, kicadModel, installedModels, padOutline, footprintModule, prefixOf } from '../dist/index.js'
import { FOOTPRINTS, fixtureFootprints } from './helpers.mjs'

const saved = {}
before(() => {
  // the fixtures stand in for the installed library, so the tests run the same with or without KiCad
  for (const k of ['KICAD10_FOOTPRINT_DIR', 'KICAD_FOOTPRINTS']) saved[k] = process.env[k]
  process.env.KICAD10_FOOTPRINT_DIR = FOOTPRINTS
})
after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v })

const rot = (p, deg) => { const t = deg * Math.PI / 180; return [p[0] * Math.cos(t) + p[1] * Math.sin(t), -p[0] * Math.sin(t) + p[1] * Math.cos(t)] }
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`)
const COPPER = /^(F|B)\.Cu$|^\*\.Cu$/

/** The copper pads of a .kicad_mod as KiCad has them: number, position, angle, size, drill. */
function kicadPads(file) {
  return readKicadMod(file).pads.filter(p => p.kind === 'np_thru_hole' || p.layers.some(l => COPPER.test(l)))
}

test('sexpr: lists, quoted strings with escapes, atoms', () => {
  const l = parseSExpr('(a "b \\"c\\"" (d 1.5 -2) e\n(f "x\\\\y"))')
  assert.deepEqual(l, ['a', 'b "c"', ['d', '1.5', '-2'], 'e', ['f', 'x\\y']])
  assert.throws(() => parseSExpr('(a (b)'), /unbalanced/)
})

test('fixtures: a dozen and more library footprints that cover every pad shape and type', () => {
  const kinds = new Set(), shapes = new Set()
  for (const [, file] of fixtureFootprints()) for (const p of readKicadMod(file).pads) { kinds.add(p.kind); shapes.add(p.shape); if (p.chamfer) shapes.add('chamfered') ; if (p.drill && p.drill[0] !== p.drill[1]) shapes.add('slot') }
  assert.ok(fixtureFootprints().length >= 12)
  for (const k of ['smd', 'thru_hole', 'np_thru_hole', 'connect']) assert.ok(kinds.has(k), k)
  for (const s of ['circle', 'rect', 'oval', 'roundrect', 'trapezoid', 'custom', 'chamfered', 'slot']) assert.ok(shapes.has(s), s)
})

for (const [id, file] of fixtureFootprints()) {
  test(`round trip: ${id} compiles with every pad where KiCad puts it, front and back`, () => {
    const def = readFootprint(file)
    const F = defineFootprint(def.render, def.meta)
    const kp = kicadPads(file)
    for (const [side, a] of [['F', 30], ['B', -60]]) {
      const at = [20, 15]
      // KiCad's back flip is top to bottom; pcbjs mirrors left to right, so the angle takes a half turn more
      const props = side === 'F' ? { ref: 'U1', at: [...at, a] } : { ref: 'U1', at: [...at, a + 180], side: 'B' }
      const b = compileBoard(h(PCB, { name: 'T' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 40, h: 30 }), h(F, props)))
      const pads = b.items.filter(i => i.kind === 'pad')
      assert.ok(pads.length >= kp.length, `${pads.length} pads for ${kp.length} KiCad pads`)
      for (const k of kp) {
        const local = side === 'F' ? k.at : [k.at[0], -k.at[1]]
        const r = rot(local, a)
        const want = [at[0] + r[0], at[1] + r[1]]
        const ks0 = k.shape === 'circle' ? [k.size[0], k.size[0]] : k.size
        const here = pads.filter(p => p.num === k.num && Math.hypot(p.at[0] - want[0], p.at[1] - want[1]) < 1e-6)
        const hit = here.find(p => Math.abs(p.size[0] - ks0[0]) < 1e-9 && Math.abs(p.size[1] - ks0[1]) < 1e-9) ?? here[0]
        assert.ok(hit, `${id} ${side}: pad ${k.num} at ${want.map(v => v.toFixed(4))}; pcbjs has ${pads.filter(p => p.num === k.num).map(p => p.at.map(v => v.toFixed(4)))}`)
        if (!padOutline(k) && !k.stack) {
          const ks = k.shape === 'circle' ? [k.size[0], k.size[0]] : k.size
          near(hit.size[0], ks[0], 1e-9, `${id} pad ${k.num} width`)
          near(hit.size[1], ks[1], 1e-9, `${id} pad ${k.num} height`)
          // the pad's angle on the board: its own plus the part's, the back flip negating its own
          const want = side === 'F' ? k.rot + a : -k.rot + a
          const d = ((hit.rot - want) % 180 + 540) % 180
          assert.ok(d < 1e-6 || 180 - d < 1e-6 || (ks[0] === ks[1] && k.shape !== 'rect' && k.shape !== 'roundrect'), `${id} pad ${k.num} angle ${hit.rot} vs ${want}`)
        }
        if (k.drill) { assert.ok(hit.drill, `${id} pad ${k.num} drill`); near(Math.min(...hit.drill), Math.min(...k.drill), 1e-9, `${id} pad ${k.num} drill`) }
      }
    }
  })
}

test('pad shapes: trapezoid, chamfered and custom pads are polygons; a paste window gives its pad paste', () => {
  const trap = readFootprint(join(FOOTPRINTS, 'Diode_SMD.pretty/D_SMA-SMB_Universal_Handsoldering.kicad_mod')).elements.find(e => e.type === 'pad' && e.props.num === '1')
  assert.equal(trap.props.shape, 'custom')
  // rect_delta 0.6 0: the left end 0.6 mm taller than the right
  const xs = trap.props.points.map(p => p[0]), left = trap.props.points.filter(p => p[0] === Math.min(...xs)), right = trap.props.points.filter(p => p[0] === Math.max(...xs))
  near(Math.max(...left.map(p => p[1])) - Math.min(...left.map(p => p[1])) - (Math.max(...right.map(p => p[1])) - Math.min(...right.map(p => p[1]))), 1.2, 1e-9, 'trapezoid')
  const qfn = readFootprint(join(FOOTPRINTS, 'Package_DFN_QFN.pretty/QFN-16-1EP_3x3mm_P0.5mm_EP1.7x1.7mm.kicad_mod'))
  const ep = qfn.elements.find(e => e.type === 'pad' && e.props.num === '17')
  assert.ok(ep && ep.props.paste !== false, 'the exposed pad takes the paste of its windows')
  assert.equal(qfn.elements.filter(e => e.type === 'pad' && e.props.num === '').length, 0, 'paste windows are no pads')
  const edge = readFootprint(join(FOOTPRINTS, 'Connector_PCBEdge.pretty/Samtec_MECF-05-0_-NP-L-DV_2x05_P1.27mm_Edge.kicad_mod'))
  assert.ok(edge.elements.some(e => e.type === 'pad' && e.props.layers?.[0] === 'B.Cu'), 'back pads of an edge connector stay on B.Cu')
})

test('graphics: arcs stay arcs, lines chain into paths, every layer with its width', () => {
  const mb = readFootprint(join(FOOTPRINTS, 'Panelization.pretty/MouseBite-Part_2.0x2.0mm_0h.kicad_mod'))
  assert.ok(mb.elements.some(e => e.type === 'path' && / A /.test(e.props.d)), 'an fp_arc is an A command')
  const soic = readFootprint(join(FOOTPRINTS, 'Package_SO.pretty/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod'))
  const layers = new Set(soic.elements.filter(e => e.type !== 'pad').map(e => e.props.layer))
  for (const l of ['F.SilkS', 'F.Fab', 'F.CrtYd']) assert.ok(layers.has(l), l)
  assert.ok(soic.elements.some(e => e.props.layer === 'F.SilkS' && e.props.width === 0.12))
  assert.ok(soic.elements.some(e => e.props.layer === 'F.SilkS' && e.props.fill), 'the filled pin 1 marker')
})

test('kicadFootprint: Lib:Name and bare names resolve, pins from pad numbers, pinNames rename, the model resolves', () => {
  const S = kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm')
  assert.deepEqual([...S.pins], ['1', '2', '3', '4', '5', '6', '7', '8'])
  assert.equal(S.prefix, 'U')
  assert.equal(kicadFootprint('R_0603_1608Metric').prefix, 'R')
  const N = kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', { pinNames: { 4: 'GND', 8: 'VCC', 5: 'NC' } })
  assert.ok(N.pins.includes('GND') && N.pins.includes('VCC') && !N.pins.includes('5'))
  assert.deepEqual([...N.nc], ['5'])
  const U = kicadFootprint('Connector_USB:USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal')
  assert.ok(U.pins.includes('A1') && U.pins.includes('SH') && !U.pins.includes(''))
  assert.throws(() => kicadFootprint('Nope:Nothing'), /no footprint "Nope:Nothing"/)
  const d = readFootprint(join(FOOTPRINTS, 'Package_SO.pretty/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod'))
  assert.match(String(d.props.model?.file), /Package_SO\.3dshapes\/SOIC-8_3\.9x4\.9mm_P1\.27mm\.(step|wrl)$/)
  if (installedModels()) assert.ok(!String(d.props.model.file).includes('${'), 'the KiCad model variable is resolved')
  assert.equal(kicadModel('${KIPRJMOD}/x.step', '/p'), '/p/x.step')
  assert.equal(prefixOf('Connector_JST', 'JST_PH_B2B'), 'J')
})

test('readFootprint: a part with nets compiles; the cache keys on the content', () => {
  const S = kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm')
  assert.equal(kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm').id, S.id)
  const b = compileBoard(h(PCB, { name: 'T' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 }), h(S, { ref: 'U1', at: [10, 10], nets: { 1: 'A', 8: 'B' } })))
  assert.equal(b.items.filter(i => i.kind === 'pad' && i.net === 'A').length, 1)
})

test('import footprint: the module names its source and licence and carries pads, graphics and the model reference', () => {
  const fp = readKicadMod(join(FOOTPRINTS, 'Connector_Molex.pretty/Molex_Nano-Fit_105309-xx02_1x02_P2.50mm_Vertical.kicad_mod'))
  fp.lib = 'Connector_Molex'
  const m = footprintModule(fp, { source: 'Connector_Molex:Molex_Nano-Fit_105309-xx02_1x02_P2.50mm_Vertical' })
  assert.match(m.code, /^\/\/ Molex_Nano-Fit_105309-xx02_1x02_P2\.50mm_Vertical: imported from Connector_Molex:/)
  assert.match(m.code, /Licence:/)
  assert.match(m.code, /kicadModel\('\$\{KICAD10_3DMODEL_DIR\}\/Connector_Molex\.3dshapes\//)
  assert.match(m.code, /<pad num="1" at="0 0" shape="custom"/)
  assert.match(m.code, /type="npth"/)
  assert.match(m.code, /layer="F\.CrtYd"/)
  assert.match(m.code, /export const Molex_Nano_Fit_105309_xx02_1x02_P2_50mm_Vertical = defineFootprint\(/)
  assert.ok(readFileSync(join(FOOTPRINTS, 'Connector_Molex.pretty/Molex_Nano-Fit_105309-xx02_1x02_P2.50mm_Vertical.kicad_mod'), 'utf8').includes('(primitives'))
})
