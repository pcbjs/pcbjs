// Every standard library footprint has a body: a model file fetched on first use, a generated body, none for bare pads, or a
// dashed outline with the reason it has no model. A bare box, the outline with no reason, never ships.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import PCB, { h } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import * as lib from '../dist/index.js'

const FACTORIES = {
  R0402: [lib.R0402], R0603: [lib.R0603], R0805: [lib.R0805], R1206: [lib.R1206],
  C0402: [lib.C0402], C0603: [lib.C0603], C0805: [lib.C0805], C1206: [lib.C1206],
  LED0603: [lib.LED0603], LED0805: [lib.LED0805], LED1206: [lib.LED1206], LED: [lib.LED('0402', 'red')],
  PinHeader: [lib.PinHeader.footprint ? lib.PinHeader.footprint(4) : lib.PinHeader],
  SOT23: [lib.SOT23(3), lib.SOT23(5), lib.SOT23(6)], SOT223: [lib.SOT223], SOIC: [lib.SOIC(8), lib.SOIC(16, 'W')], TSSOP: [lib.TSSOP(20)],
  QFN: [lib.QFN(32, 5, 0.5, 3.1)], LQFP: [lib.LQFP(48, 7, 0.5)], WS2812B: [lib.WS2812B('2020'), lib.WS2812B('5050')],
  CR2032Holder: [lib.CR2032Holder], BatteryPads: [lib.BatteryPads()],
  TactSwitch: ['6x6', '5.1x5.1', '4.5x4.5', '4.2x3.2', '3x4'].map(s => lib.TactSwitch(s)), SlideSwitch: [lib.SlideSwitch()],
  Crystal3225: [lib.Crystal3225], Crystal2012: [lib.Crystal2012], Crystal3215: [lib.Crystal3215], Crystal5032: [lib.Crystal5032], Crystal49S: [lib.Crystal49S],
  ESP32C3Mini1: [lib.ESP32C3Mini1], ESP32C3Mini1Footprint: [lib.ESP32C3Mini1Footprint({ antennaKeepout: false })],
  USBC: [lib.USBC.footprint('full16'), lib.USBC.footprint('power6')],
  JST_PH: [lib.JST_PH.footprint(2), lib.JST_PH.footprint(16), lib.JST_PH.footprint(4, 'side')], JST_XH: [lib.JST_XH.footprint(2), lib.JST_XH.footprint(16)],
  PinSocket: [lib.PinSocket.footprint(1), lib.PinSocket.footprint(40), lib.PinSocket.footprint(3, { rows: 2 })],
  TestPad: [lib.TestPad()], PogoPad: [lib.PogoPad(1.5, { cols: 3, rows: 2 })], MountingHole: [lib.MountingHole(), lib.MountingHole(3.2, true)],
}

const GENERATED = new Set(['chip', 'led', 'header', 'sot23', 'ic'])
const SOURCE = /^(kicad:[\w.+-]+\.3dshapes\/[\w.+-]+\.step|lcsc:C\d+|https:\/\/\S+\.step)$/i

test('the table lists every footprint factory and generator of the library', () => {
  // Brand is a silk drawing, not a footprint
  const fns = Object.entries(lib).filter(([k, v]) => /^[A-Z]/.test(k) && typeof v === 'function' && k !== 'Brand').map(([k]) => k)
  assert.deepEqual(fns.filter(k => !(k in FACTORIES)), [])
})

test('every footprint has a model file, a generated body, no body or a reason, never a bare box', () => {
  const all = Object.values(FACTORIES).flat()
  const kids = all.map((F, i) => h(F, { ref: `X${i + 1}`, at: `${10 + (i % 10) * 25} ${10 + Math.floor(i / 10) * 25}` }))
  const b = compileBoard(h(PCB, { name: 'models' }, h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 260, h: 160 }), ...kids), { routeCache: false })
  assert.equal(b.footprints.length, all.length)
  for (const fp of b.footprints) {
    const m = fp.model
    const ok = GENERATED.has(m?.kind) || m?.kind === 'none' || (m?.kind === 'box' && (SOURCE.test(m.fetch ?? '') || !!m.reason))
    assert.ok(ok, `${fp.ref} ${fp.id}: ${JSON.stringify(m)}`)
  }
})

test('a box model in the source is only the outline helper', () => {
  const dir = new URL('../src/', import.meta.url)
  for (const f of readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'models.ts'))
    assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /kind: 'box'/, f)
})
