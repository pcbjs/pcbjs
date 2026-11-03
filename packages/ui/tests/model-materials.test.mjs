// Generated models are opaque solids: an LED lens is its tint with a mild glow, the clear one grey-white, depth written, never transparent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { ledModel } = await import('../src/models/led.ts')
const { chipModel } = await import('../src/models/chip.ts')
const { headerModel } = await import('../src/models/header.ts')
const { sot23Model } = await import('../src/models/sot23.ts')
const { boxModel } = await import('../src/models/box.ts')
const { LED_CLEAR, LED_TINT } = await import('@pcbjs/export/internal/scene/colors')

function materials(obj) {
  const out = []
  obj.traverse(o => o.isMesh && out.push(o.material))
  return out
}
function assertOpaque(obj, what) {
  for (const m of materials(obj)) {
    assert.equal(m.transparent, false, what)
    assert.equal(m.opacity, 1, what)
    assert.equal(m.depthWrite, true, what)
  }
}
const hex = m => `#${m.color.getHexString()}`
const LED = { kind: 'led', body: [1.6, 0.8], cap: 0.3, height: 0.8 }

test('an LED lens is an opaque solid in its tint, dome and flat, chip and PLCC', () => {
  for (const lens of ['dome', 'flat']) {
    for (const color of [undefined, 'red', 'green', 'white', 'pink']) assertOpaque(ledModel({ ...LED, color, lens }), `${color} ${lens}`)
  }
  assertOpaque(ledModel({ kind: 'led', body: [5, 5], height: 1.6, window: 4.2, lead: [0.6, 1.0] }), 'PLCC')
  const red = materials(ledModel({ ...LED, color: 'red' })).find(m => hex(m) === LED_TINT.red)
  assert.ok(red && red.emissiveIntensity > 0 && red.emissiveIntensity < 0.5, 'a mild glow in its own colour')
  for (const color of [undefined, 'white']) {
    const clear = materials(ledModel({ ...LED, color })).find(m => hex(m) === LED_CLEAR)
    assert.ok(clear && clear.emissiveIntensity < red.emissiveIntensity, `${color}: the clear lens`)
  }
})

test('every other generated body is opaque too', () => {
  for (const part of ['R', 'C', 'L', 'D']) assertOpaque(chipModel({ kind: 'chip', part, body: [1.6, 0.8], cap: 0.3, height: 0.5 }), part)
  assertOpaque(headerModel({ kind: 'header', pins: 3, rows: 1, pitch: 2.54 }, 8.5, 1.6), 'header')
  assertOpaque(sot23Model({ kind: 'sot23', pins: 3 }, 1.1), 'sot23')
  assertOpaque(boxModel({ kind: 'ic', w: 4, h: 4, height: 1 }), 'ic')
})
