// Each removed spelling of a name, unit, prop, font, default or target key is a clear error naming the one form.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import PCB, { h, variants, defineDefaultBoard, resetDefaults } from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { withMaskColor } from '@pcbjs/core/internal/rules'
import { resolveRepo } from '@pcbjs/cli/internal/repo'
import { SOT23, R0603, withPins } from '@pcbjs/lib'
import { kicadFootprint } from '@pcbjs/kicad'
import { fp } from './parts.mjs'

afterEach(() => resetDefaults())

const edge = () => h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 20 })
const board = (props, ...kids) => compileBoard(h(PCB, { name: 'F', ...props }, edge(), ...kids), { cache: false })
const pad = props => fp({ ref: 'U1', at: '5 5', ...props }, h('pad', { num: 1, size: 1, type: 'smd' }))

test('side is F or B only', () => {
  assert.equal(board({}, pad({ side: 'B' })).footprints[0].side, 'B')
  for (const side of ['top', 'bottom', 'front', 'back', 'b', 'f']) assert.throws(() => board({}, pad({ side })), new RegExp(`bad side "${side}": side is "F" or "B"`))
})

test('code names layers by id, as written: the aliases are for CLI flags and the viewer URL', () => {
  for (const layer of ['top', 'silk', 'edge', 'f.cu', 'F.Silk'])
    assert.throws(() => board({}, h('rect', { layer, x: 1, y: 1, w: 1, h: 1 })), new RegExp(`unknown layer "${layer.replace('.', '\\.')}"`))
})

test('fonts are declared on <PCB fonts> as { file }, and <text font> is a name', () => {
  const text = font => h('text', { layer: 'F.SilkS', at: '5 5', size: 1, font }, 'X')
  assert.equal(board({}, text('hershey')).items.filter(i => i.kind === 'text').length, 1)
  assert.throws(() => board({}, text('hershey-simplex')), /font "hershey-simplex" is not in the fonts of <PCB>; "hershey" and "newstroke" are the stroke fonts/)
  assert.throws(() => board({}, text({ file: './x.ttf' })), /font must be a name: "hershey", "newstroke" or a name in the fonts of <PCB>/)
  assert.throws(() => board({ fonts: { slab: './x.ttf' } }, text('slab')), /font "slab" of <PCB F> fonts must be \{ file \}/)
  assert.throws(() => defineDefaultBoard({ fonts: { slab: { file: './x.ttf' } } }), /fonts are declared on <PCB fonts>/)
})

test('a variant target has one rules and one fabNotes, on the target', () => {
  const V = rules => variants({ name: 'A', board: rules })
  assert.throws(() => V({ rules: { clearance: 0.2 } }), /variants: target 1 has board\.rules; give rules on the target itself/)
  assert.throws(() => V({ fabNotes: ['x'] }), /variants: target 1 has board\.fabNotes; give fabNotes on the target itself/)
  assert.throws(() => V({ fonts: {} }), /target 1 has board\.fonts; fonts are declared on <PCB fonts>/)
})

test('one comparison of colour names, the palette and the mask web table alike', () => {
  const r = withMaskColor({ maskWeb: 0.1, maskWebByColor: { 'Matte Black': 0.13 } }, 'matte-black')
  assert.equal(r.maskWeb, 0.13)
})

test('repo is an object, MPN keys are spelled MPN, and pins are renamed with withPins', () => {
  assert.throws(() => resolveRepo('https://github.com/o/x', '/p', () => null), /repo must be an object such as \{ url: 'https:\/\/github\.com\/me\/board' \}/)
  assert.throws(() => R0603('1k').source({ mpn: 'X' }), /"mpn" is spelled MPN/)
  assert.throws(() => R0603('1k').source({ 'Mpn:LCSC': 'C1' }), /"Mpn:LCSC" is spelled MPN/)
  assert.throws(() => SOT23(5, { pinNames: ['A', 'B', 'C', 'D', 'E'] }), /SOT23: rename pins with withPins\(footprint, names\), not a pinNames option/)
  assert.deepEqual(withPins(SOT23(5), ['A', 'B', 'C', 'D', 'E']).pins, ['A', 'B', 'C', 'D', 'E'])
  assert.throws(
    () => kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', { pinNames: { 4: 'GND' } }),
    /kicadFootprint: rename pins with withPins\(kicadFootprint\(id\), names\) of @pcbjs\/lib/,
  )
  assert.throws(() => kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', { footprints: ['lib'] }), /kicadFootprint: library folders go in kicad\.footprints of pcb\.config\.ts/)
})
