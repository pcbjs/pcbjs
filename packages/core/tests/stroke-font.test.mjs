import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strokeText, strokeFontName, glyphOf } from '../dist/text.js'
import { NEWSTROKE, NEWSTROKE_CAP, NEWSTROKE_EXTRA } from '../dist/fonts/newstroke.js'

// at size 21 a font unit is 1 mm; y is down, the baseline at 0
const lay = (s, o = {}) => strokeText(s, { size: 21, thickness: 0, anchor: 'start', font: 'newstroke', ...o })
const span = t => { const ys = t.strokes.flat().map(p => p[1]); return [Math.min(...ys), Math.max(...ys)] }

test('newstroke: names, coverage and the cap height of KiCad\'s glyph size', () => {
  assert.equal(strokeFontName(undefined), 'hershey')
  assert.equal(strokeFontName('hershey-simplex'), 'hershey')
  assert.equal(strokeFontName('newstroke'), 'newstroke')
  assert.equal(strokeFontName('slab'), null)
  assert.equal(NEWSTROKE_CAP, 21)
  assert.equal(NEWSTROKE.length, 95)
  for (let c = 0xa0; c <= 0xff; c++) assert.ok(NEWSTROKE_EXTRA[String.fromCharCode(c)], `U+${c.toString(16)}`)
  for (const ch of '©°Ωµ') assert.ok(glyphOf(ch, 'newstroke'), ch)
  // the ohm sign is the capital omega
  assert.deepEqual(glyphOf('Ω', 'newstroke'), glyphOf('Ω', 'newstroke'))
  // Hershey stays the default
  assert.deepEqual(glyphOf('H'), glyphOf('H', 'hershey'))
  assert.notDeepEqual(glyphOf('H'), glyphOf('H', 'newstroke'))
})

test('newstroke: stroke counts, advances and extents of a few glyphs', () => {
  const want = { H: [3, 22, -21, 0], A: [2, 18, -21, 0], o: [1, 19, -14, 0], '©': [2, 36, -24, 4], '°': [1, 16, -21, -15], 'Ω': [1, 24, -21, 0], 'µ': [3, 22, -14, 7], '~': [1, 15, -10, -8] }
  for (const [ch, [n, adv, top, bottom]] of Object.entries(want)) {
    const t = lay(ch)
    assert.equal(t.strokes.length, n, `${ch} strokes`)
    assert.equal(t.width, adv, `${ch} advance`)
    assert.deepEqual(span(t), [top, bottom], `${ch} extent`)
    assert.deepEqual(t.missing, [])
  }
  // the vertical stem of H runs from the baseline to the cap line
  assert.deepEqual(lay('H').strokes[0], [[5, 0], [5, -21]])
})

test('newstroke: size, width and anchor scale as for Hershey; a missing glyph is a box', () => {
  const t = strokeText('H', { size: 1.2, width: 1.4, thickness: 0.25, anchor: 'middle', font: 'newstroke' })
  assert.equal(t.width, 1.466667)
  assert.equal(t.height, 1.2)
  assert.deepEqual(t.strokes[0], [[-0.4, 0], [-0.4, -1.2]])
  const s = lay('☃')
  assert.deepEqual(s.missing, ['☃'])
  assert.equal(s.width, 16)
})
