// KiCad's TrueType text through the importer: the face found in a font folder, copied into fonts/ with its licence, named in
// <PCB fonts>, and sized so the ink lands where KiCad 9 draws it; a face that is not installed stays Hershey with a comment; KiCad's stroke text is NewStroke.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB from '@pcbjs/core'
import { compileBoard } from '@pcbjs/compile'
import { importBoard } from '../dist/import-board.js'
import { findFont, kicadOutlineText } from '../dist/fonts.js'

const fontDir = fileURLToPath(new URL('../../core/tests/fixtures/fonts/', import.meta.url))
const board = fileURLToPath(new URL('./fixtures/boards/roboto-slab-text.kicad_pcb', import.meta.url))

test('fonts: findFont reads the family from the name table and takes weight 700 of a variable font for bold', () => {
  const f = findFont('Roboto Slab', { bold: true, dirs: [fontDir] })
  assert.ok(f)
  assert.equal(f.family, 'Roboto Slab')
  assert.equal(f.weight, 700)
  assert.equal(f.style, 'Bold')
  assert.match(f.license, /Apache License, Version 2\.0/)
  assert.equal(findFont('Roboto Slab', { dirs: [fontDir] }).weight, 400)
  assert.equal(findFont('No Such Face', { dirs: [fontDir] }), null)
})

test('fonts: KiCad size 2 is a cap height of 1.4 x 2 x capHeight / unitsPerEm, the baseline 0.415 x size below at', () => {
  const f = findFont('Roboto Slab', { bold: true, dirs: [fontDir] }).font
  const m = kicadOutlineText(f, [2, 2])
  assert.equal(m.size, 1.990625) // 2.8 x 1456 / 2048
  assert.equal(m.width, 1.990625)
  assert.equal(m.dy, Math.round((0.83 - m.size / 2) * 1e6) / 1e6)
})

test("import: Roboto Slab text is copied, licensed, named in fonts and lands on KiCad's ink", () => {
  const res = importBoard(board, { schematic: false, fontDirs: [fontDir] })
  assert.deepEqual([...res.copies.keys()], ['fonts/RobotoSlab-subset.ttf'])
  assert.match(res.files.get('fonts/LICENSES.md'), /RobotoSlab-subset\.ttf`: Roboto Slab, Copyright 2018 .*Apache License, Version 2\.0/)
  const pcb = res.files.get('pcb.tsx')
  assert.match(pcb, /fonts=\{\{ 'roboto-slab-bold': \{ file: '\.\/fonts\/RobotoSlab-subset\.ttf', weight: 700 \} \}\}/)
  assert.match(pcb, /<text layer="F\.SilkS" at="0 2\.374687" size=\{1\.990625\} font="roboto-slab-bold">© 2025 Yuxuan Zhang<\/text>/)
  assert.match(
    pcb,
    /\{\/\* KiCad font "No Such Face" is not installed here: drawn in Hershey \*\/\}\n\s*<text layer="F\.SilkS" at="0 6" size=\{1\} thickness=\{0\.15\}>NOT HERE<\/text>/,
  )
  assert.ok(res.notes.some(n => /"No Such Face" is drawn in Hershey/.test(n)))

  // the imported props compiled: the ink box of KiCad 9's render cache of the same text, within 0.03 mm
  const b = compileBoard(
    h(
      PCB,
      { name: 'T', fonts: { 'roboto-slab-bold': { file: fontDir + 'RobotoSlab-subset.ttf', weight: 700 } } },
      h('text', { layer: 'F.SilkS', at: '0 2.374687', size: 1.990625, font: 'roboto-slab-bold' }, '© 2025 Yuxuan Zhang'),
      h('text', { layer: 'B.SilkS', at: '0 9.884281', size: 1.393438, font: 'roboto-slab-bold' }, 'V'),
    ),
  )
  const box = t => {
    const p = t.polys.flatMap(q => q.outer)
    return [Math.min(...p.map(q => q[0])), Math.max(...p.map(q => q[0])), Math.min(...p.map(q => q[1])), Math.max(...p.map(q => q[1]))]
  }
  const [copy, stamp] = b.items.filter(i => i.kind === 'text')
  box(copy).forEach((v, i) => assert.ok(Math.abs(v - [-14.639915, 14.70635, 1.236294, 3.971814][i]) < 0.03, `© text ${i}: ${v}`))
  // the V of KiCad's "V0.1.2 | DEV" at size 1.4 on the back, mirrored as KiCad's (justify mirror): cap line and baseline
  assert.equal(stamp.mirrored, true)
  const [, , y0, y1] = box(stamp)
  assert.ok(Math.abs(y0 - 9.185884) < 0.03 && Math.abs(y1 - 10.581) < 0.03, `V ink y ${y0} ${y1}`)
})

test('import: KiCad stroke text is font="newstroke", its at moved so the ink lands where KiCad 9 strokes it', async () => {
  const { textSpec, kicadStrokeShift } = await import('../dist/footprint.js')
  const k = { kind: 'user', text: 'H', at: [10, 5], rot: 0, layer: 'F.SilkS', size: [1.2, 1.4], thickness: 0.25, hidden: false, justify: [] }
  const mid = textSpec(k, 'F.SilkS')
  assert.deepEqual(mid.props, { layer: 'F.SilkS', at: '10 4.942143', size: 1.2, width: 1.4, thickness: 0.25, font: 'newstroke' })
  const left = textSpec({ ...k, justify: ['left', 'top'] }, 'F.SilkS')
  assert.equal(left.props.anchor, 'start')
  assert.deepEqual(kicadStrokeShift({ ...k, justify: ['left', 'top'] }), [0.164474, 0.644143])
  // KiCad: the baseline 0.415 x h - 0.052 x thickness + h / 21 below a centred at, the stem of H 5/21 of the width from the
  // glyph's left edge, the line's 22/21 x width advance centred on at; top-left text starts thickness / 1.52 right of at
  const compiled = s => compileBoard(h(PCB, { name: 'T' }, h('text', s.props, ...s.children))).items.find(i => i.kind === 'text')
  const t = compiled(mid)
  assert.equal(t.font, 'newstroke')
  const stem = t.strokes[0]
  const base = 5 + 0.415 * 1.2 - 0.052 * 0.25 + 1.2 / 21
  assert.ok(
    Math.abs(stem[0][0] - (10 - (1.4 * 22) / 21 / 2 + (1.4 * 5) / 21)) < 1e-6 && Math.abs(stem[0][1] - base) < 1e-6 && Math.abs(stem[1][1] - (base - 1.2)) < 1e-6,
    JSON.stringify(stem),
  )
  const l = compiled(left).strokes[0]
  assert.ok(Math.abs(l[0][0] - (10 + 0.25 / 1.52 + (1.4 * 5) / 21)) < 1e-6 && Math.abs(l[0][1] - (5 + 1.2 + 1.2 / 21 - 0.013)) < 1e-6, JSON.stringify(l))
})
