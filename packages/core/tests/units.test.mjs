import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mm, deg, at } from '../dist/units.js'
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
  assert.throws(() => mm('abc'), /bad length/)
  assert.throws(() => mm('1 2'), /bad length/)
})

test('deg: numbers, deg and turn', () => {
  assert.equal(deg(45), 45)
  assert.equal(deg('90deg'), 90)
  assert.equal(deg('0.25turn'), 90)
  near(deg(`${Math.PI}rad`), 180, 1e-9)
  assert.equal(deg(undefined), 0)
})

test('deg: errors on bad units', () => {
  assert.throws(() => deg('5grad'), /bad rotation/)
})

test('at: strings and tuples', () => {
  assert.deepEqual(at('3mm 7.46mm'), [3, 7.46, 0])
  assert.deepEqual(at('1 2 90deg'), [1, 2, 90])
  assert.deepEqual(at([1, '2mm']), [1, 2, 0])
  assert.deepEqual(at([1, 2, '0.5turn']), [1, 2, 180])
  assert.deepEqual(at(undefined), [0, 0, 0])
})

test('at: errors on bad positions', () => {
  assert.throws(() => at('1'), /bad position/)
  assert.throws(() => at('1 2 3 4'), /bad position/)
  assert.throws(() => at('1 2zz'), /unknown unit/)
})
