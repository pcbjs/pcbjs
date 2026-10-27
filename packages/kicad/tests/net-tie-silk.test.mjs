// Net ties carried from KiCad's net_tie_pad_groups, and the silk option of kicadFootprint.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { readKicadMod, readFootprint, kicadFootprint, footprintModule } from '../dist/index.js'
import { FOOTPRINTS } from './helpers.mjs'

const saved = {}
before(() => {
  for (const k of ['KICAD10_FOOTPRINT_DIR', 'KICAD_FOOTPRINTS']) saved[k] = process.env[k]
  process.env.KICAD10_FOOTPRINT_DIR = FOOTPRINTS
})
after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v })

// a Kelvin shunt: sense tabs 2 and 3 overlap the current pads 1 and 4
const SHUNT = `(footprint "Shunt_Kelvin" (version 20240108) (generator "test") (layer "F.Cu")
  (attr smd)
  (net_tie_pad_groups "1, 2" "3, 4")
  (fp_line (start -2 1.2) (end 2 1.2) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (pad "1" smd rect (at -1.165 0) (size 1.57 1.78) (layers "F.Cu" "F.Mask" "F.Paste"))
  (pad "2" smd rect (at -0.58 0.925) (size 0.4 0.65) (layers "F.Cu" "F.Mask"))
  (pad "3" smd rect (at 0.58 0.925) (size 0.4 0.65) (layers "F.Cu" "F.Mask"))
  (pad "4" smd rect (at 1.165 0) (size 1.57 1.78) (layers "F.Cu" "F.Mask" "F.Paste"))
)`

test('net tie: net_tie_pad_groups is read, written by the importer and compiles without a short', () => {
  assert.deepEqual(readKicadMod(SHUNT).netTie, [['1', '2'], ['3', '4']])
  const { code } = footprintModule(readKicadMod(SHUNT))
  assert.match(code, /netTie: \[\['1', '2'\], \['3', '4'\]\]/)
  const def = readFootprint(SHUNT)
  assert.deepEqual(def.meta.netTie, [['1', '2'], ['3', '4']])
  const b = compileBoard(h(PCB, { name: 'T' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 10, h: 10 }),
    h(def.render, { ref: 'RS1', at: '5 5', 'net:1': 'HI', 'net:2': 'SP', 'net:3': 'SN', 'net:4': 'LO' })))
  assert.deepEqual(b.drc.filter(d => d.rule === 'short' || d.rule === 'clearance').map(d => d.message), [])
  assert.deepEqual(b.footprints[0].netTie, [['1', '2'], ['3', '4']])
})

test('kicadFootprint silk: none drops the footprint silk, full and open keep it', () => {
  const silkOf = (F) => {
    const b = compileBoard(h(PCB, { name: 'T' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 10, h: 10 }), h(F, { ref: 'R1', at: '5 5', refAt: false })))
    return { n: b.items.filter(i => i.layer.endsWith('.SilkS')).length, id: b.footprints[0].id }
  }
  const full = silkOf(kicadFootprint('Resistor_SMD:R_0603_1608Metric'))
  assert.ok(full.n > 0, 'the library footprint draws silk')
  assert.equal(full.id, 'Resistor_SMD:R_0603_1608Metric')
  assert.deepEqual(silkOf(kicadFootprint('Resistor_SMD:R_0603_1608Metric', { silk: 'open' })), full)
  assert.deepEqual(silkOf(kicadFootprint('Resistor_SMD:R_0603_1608Metric', { silk: 'none' })), { n: 0, id: 'Resistor_SMD:R_0603_1608Metric_NoSilkScreen' })
  assert.throws(() => kicadFootprint('Resistor_SMD:R_0603_1608Metric', { silk: 'thin' }), /silk must be 'full', 'open', 'none'/)
})
