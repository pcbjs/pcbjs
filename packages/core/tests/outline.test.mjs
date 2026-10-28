// Outline fonts on the Roboto Slab fixture: metrics and advances against fontTools' instancer, kerning, the union of
// contours, the cap-height size mapping on a known glyph, the KiCad size conversion and the thin-ink guard.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { loadOutlineFont, outlineText, kicadOutlineSize, thinInk, offsetPolys, unionNonZero } from '../dist/outline.js'
import { near } from './helpers.mjs'

const file = fileURLToPath(new URL('./fixtures/fonts/RobotoSlab-subset.ttf', import.meta.url))
// size 1.456 mm is the cap height of 1456 units, so a font unit is 1 um
const unit = { size: 1.456, anchor: 'start' }
const box = polys => {
  const p = polys.flatMap(q => q.outer)
  return [Math.min(...p.map(q => q[0])), Math.min(...p.map(q => q[1])), Math.max(...p.map(q => q[0])), Math.max(...p.map(q => q[1]))]
}

test('outline: the metrics of the name table, OS/2 and fvar', () => {
  const f = loadOutlineFont(file)
  assert.equal(f.family, 'Roboto Slab')
  assert.equal(f.unitsPerEm, 2048)
  assert.equal(f.capHeight, 1456)
  assert.match(f.license, /Apache License, Version 2\.0/)
  assert.equal(loadOutlineFont(file, 700).style, 'Bold')
  assert.throws(() => loadOutlineFont(file, 1000), /outside the font's range 100 to 900/)
  assert.throws(() => loadOutlineFont(file + '.missing'), /font file not found/)
})

test('outline: advances follow the weight axis as fontTools instances them, side bearings included', () => {
  // hmtx of fontTools.varLib.instancer at wght 700: H 1600 lsb 56, A 1512, V 1535, o 1155, © 1566; at 400 H is 1578
  const b = loadOutlineFont(file, 700)
  for (const [ch, adv] of [
    ['H', 1600],
    ['A', 1512],
    ['V', 1535],
    ['o', 1155],
    ['©', 1566],
  ])
    near(outlineText(ch, b, unit).width, adv / 1000, 1e-9, ch)
  near(box(outlineText('H', b, unit).polys)[0], 0.056, 1e-6)
  near(outlineText('H', loadOutlineFont(file), unit).width, 1.578, 1e-9)
})

test('outline: size is the cap height, H spans it exactly, and width stretches across the baseline only', () => {
  const f = loadOutlineFont(file, 700)
  const t = outlineText('H', f, { size: 2, anchor: 'start' })
  const [, y0, , y1] = box(t.polys)
  near(y0, -2, 1e-6, 'the top of H is the cap line, y down')
  near(y1, 0, 1e-6, 'the bottom of H is the baseline')
  const wide = outlineText('H', f, { size: 2, width: 4, anchor: 'start' })
  near(wide.width, 2 * t.width, 1e-6)
  near(box(wide.polys)[1], -2, 1e-6)
  assert.equal(t.height, 2)
  assert.equal(outlineText('H\nH', f, { size: 2, anchor: 'start' }).height, 2 + 3.2)
})

test('outline: kerning pulls AV together by the GPOS pair value', () => {
  const f = loadOutlineFont(file, 700)
  const kern = f.font.getKerningValue(f.font.charToGlyph('A'), f.font.charToGlyph('V'))
  assert.ok(kern < 0)
  near(outlineText('AV', f, unit).width, (1512 + 1535 + kern) / 1000, 1e-9)
})

test('outline: contours are unioned under the nonzero rule, counters as holes', () => {
  const f = loadOutlineFont(file, 700)
  const o = outlineText('O', f, unit).polys
  assert.equal(o.length, 1)
  assert.equal(o[0].holes.length, 1, 'the counter of O is a hole')
  const b = outlineText('B', f, unit).polys
  assert.equal(b[0].holes.length, 2)
  // two overlapping squares come out as one outline; a square inside another, wound the same way, adds nothing
  const sq = (x, y, s) => [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ]
  assert.equal(unionNonZero([sq(0, 0, 2), sq(1, 1, 2)]).length, 1)
  assert.equal(unionNonZero([sq(0, 0, 4), sq(1, 1, 1)])[0].holes.length, 0)
  // the copyright sign: ring and C, two pieces, the ring with its hole
  const c = outlineText('©', f, unit).polys
  assert.equal(c.length, 2)
  assert.deepEqual(c.map(p => p.holes.length).sort(), [0, 1])
})

test('outline: a character the font lacks is reported and drawn with .notdef', () => {
  const t = outlineText('A一', loadOutlineFont(file), unit)
  assert.deepEqual(t.missing, ['一'])
})

test('outline: the KiCad size conversion, em 1.4 times the size', () => {
  const f = loadOutlineFont(file, 700)
  assert.equal(kicadOutlineSize(f, 2), 1.990625)
  assert.equal(kicadOutlineSize(f, 1.4), 1.393438)
})

test('outline: thinInk finds ink thinner than the minimum and thickening by half the deficit clears it', () => {
  const thin = [
    {
      outer: [
        [0, 0],
        [2, 0],
        [2, 0.1],
        [0, 0.1],
      ],
      holes: [],
    },
  ]
  const t = thinInk(thin, 0.15)
  assert.ok(t)
  near(t.width, 0.1, 0.002)
  assert.equal(thinInk(thin, 0.09), null)
  assert.equal(thinInk(offsetPolys(thin, (0.15 - t.width) / 2 + 0.001), 0.148), null)
  // Roboto Slab Thin at 1 mm has hairlines well under 0.15 mm; Bold at 2 mm has none, its corners and serif ends do not count
  assert.ok(thinInk(outlineText('thin', loadOutlineFont(file, 100), { size: 1, anchor: 'start' }).polys, 0.15).width < 0.06)
  assert.equal(thinInk(outlineText('© 2025 Yuxuan Zhang', loadOutlineFont(file, 700), { size: 2, anchor: 'start' }).polys, 0.15), null)
})
