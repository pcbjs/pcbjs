import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mm, deg, at, parseToken, lengthMm, angleDeg, parseAt, formatAt, formatNum, isPlainNumber } from '../dist/units.js'
import { near } from './helpers.mjs'

test('mm: numbers are millimetres', () => {
  assert.equal(mm(5), 5)
  assert.equal(mm(-1.5), -1.5)
})

test('mm: strings with units', () => {
  assert.equal(mm('5mm'), 5)
  near(mm('100mil'), 2.54, 1e-12)
  near(mm('0.1in'), 2.54, 1e-12)
  assert.equal(mm('2.54'), 2.54)
  assert.equal(mm('1cm'), 10)
})

test('mm: default for missing values', () => {
  assert.equal(mm(undefined, 3), 3)
  assert.throws(() => mm(undefined), /missing length/)
})

test('mm: errors on bad input', () => {
  assert.throws(() => mm('5furlong'), /unknown unit/)
  // one spelling per unit: th is mil, and units are lower case
  assert.throws(() => mm('10th'), /unknown unit "th" in "10th": use mm, cm, m, mil, in, um, nm/)
  assert.throws(() => mm('5MM'), /unknown unit "MM"/)
  assert.throws(() => mm('100Mil'), /unknown unit "Mil"/)
  assert.throws(() => mm('abc'), /bad length/)
  assert.throws(() => mm('1 2'), /bad length/)
})

test('deg: numbers, deg and rad', () => {
  assert.equal(deg(45), 45)
  assert.equal(deg('90'), 90)
  assert.equal(deg('90deg'), 90)
  near(deg(`${Math.PI}rad`), 180, 1e-9)
  assert.equal(deg(undefined), 0)
})

test('deg: errors on bad units, turn and ° included', () => {
  assert.throws(() => deg('5grad'), /bad rotation/)
  assert.throws(() => deg('0.25turn'), /bad rotation "0.25turn": use degrees such as 90 or "90deg", or radians such as "1.57rad"/)
  assert.throws(() => deg('90°'), /bad rotation "90°"/)
})

test('at: the string form only', () => {
  assert.deepEqual(at('3mm 7.46mm'), [3, 7.46, 0])
  assert.deepEqual(at('1 2 90deg'), [1, 2, 90])
  assert.deepEqual(at('1 2 90'), [1, 2, 90])
  assert.deepEqual(at(undefined), [0, 0, 0])
  assert.throws(() => at([1, 2]), /bad position \[1,2\]: expected a string "x y \[rot\]", such as `\$\{x\} \$\{y\}`/)
  assert.throws(() => at('1, 2'), /bad length "1,"/)
})

test('at: errors on bad positions', () => {
  assert.throws(() => at('1'), /bad position/)
  assert.throws(() => at('1 2 3 4'), /bad position/)
  assert.throws(() => at('1 2zz'), /unknown unit/)
})

// one grammar for the compiler and the editor: each literal with its mm, or null where both reject it
const LENGTHS = [
  ['10mm', 10],
  ['10', 10],
  ['.5mil', 0.0127],
  ['-2.5in', -63.5],
  ['5e1', 50],
  ['1E-1mm', 0.1],
  ['1e-1mm', 0.1],
  ['+3um', 0.003],
  [' 4cm ', 40],
  ['10 mm', null],
  ['10MM', null],
  ['10th', null],
  ['1,5mm', null],
  ['mm', null],
  ['1e', null],
]

const compiled = (f, s) => {
  try {
    return f(s)
  } catch {
    return null
  }
}

test('grammar: mm() and the editor tokens accept and reject the same lengths', () => {
  for (const [s, want] of LENGTHS) {
    const t = parseToken(s)
    const editor = t ? (lengthMm(t) ?? null) : null
    const compiler = compiled(mm, s)
    if (want === null) assert.deepEqual([s, compiler, editor], [s, null, null])
    else {
      near(compiler, want, 1e-12)
      near(editor, want, 1e-12)
    }
  }
})

test('grammar: angles, positions and the spaced unit hint', () => {
  for (const [s, want] of [
    ['90', 90],
    ['90deg', 90],
    ['9E1deg', 90],
    ['90 deg', null],
    ['0.25turn', null],
    ['90°', null],
  ]) {
    const t = parseToken(s)
    assert.deepEqual([s, compiled(deg, s), t ? (angleDeg(t) ?? null) : null], [s, want, want])
  }
  assert.throws(() => mm('10 mm'), /bad length "10 mm": write the unit next to the number, "10mm"/)
  assert.throws(() => mm({ r: 1 }), /bad length {"r":1}/)
  assert.throws(() => deg('90 deg'), /write the unit next to the number, "90deg"/)
  assert.throws(() => at('1 mm 2 mm'), /expected "x y \[rot\]": write the unit next to the number, "1mm"/)
  assert.deepEqual(at('1E1mm 2 90deg'), [10, 2, 90])
  assert.equal(formatAt(parseAt('1E1mm  2  90deg')), '10mm  2  90deg')
  assert.equal(parseAt('1 mm 2'), undefined)
  assert.ok(isPlainNumber('-1.5e3') && !isPlainNumber('+1') && !isPlainNumber('1mm') && !isPlainNumber(' 1'))
  assert.equal(formatNum(-0.00001), '0')
})


test('numeric geometry units reject nonfinite values and conversion overflow', () => {
  for (const v of [NaN, Infinity, -Infinity, '1e309', '-1e309', '1e308m']) assert.throws(() => mm(v), /finite/)
  for (const v of [NaN, Infinity, -Infinity, '1e309deg', '1e308rad']) assert.throws(() => deg(v), /finite/)
  assert.throws(() => mm(undefined, Infinity), /finite/)
  assert.throws(() => deg(undefined, NaN), /finite/)
  assert.throws(() => at('1e309 0'), /finite/)
  assert.equal(parseAt('0 1e309'), undefined)
  assert.equal(mm(0), 0)
  assert.equal(deg(-450), -450)
  assert.deepEqual(at('-2 0 -90'), [-2, 0, -90])
})
