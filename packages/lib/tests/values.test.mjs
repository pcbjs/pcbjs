import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOhms, parseFarads, resistorCode, eia96, formatValue, E96 } from '../dist/values.js'
import { near } from './helpers.mjs'

test('parseOhms: plain numbers and units', () => {
  assert.equal(parseOhms('330'), 330)
  near(parseOhms('2.2'), 2.2, 1e-12)
  assert.equal(parseOhms('47Ω'), 47)
  assert.equal(parseOhms('47 ohm'), 47)
  assert.equal(parseOhms('4.7k'), 4700)
  assert.equal(parseOhms('1M'), 1e6)
  assert.equal(parseOhms('2.2 kΩ'), 2200)
})

test('parseOhms: prefix or R as the decimal point', () => {
  assert.equal(parseOhms('4k7'), 4700)
  assert.equal(parseOhms('1k5'), 1500)
  assert.equal(parseOhms('10R'), 10)
  assert.equal(parseOhms('0R'), 0)
  near(parseOhms('1R5'), 1.5, 1e-12)
  near(parseOhms('R47'), 0.47, 1e-12)
  assert.equal(parseOhms('2M2'), 2.2e6)
})

test('parseOhms: not a value gives null', () => {
  assert.equal(parseOhms('abc'), null)
  assert.equal(parseOhms(''), null)
  assert.equal(parseOhms('k'), null)
  assert.equal(parseOhms('1x'), null)
  assert.equal(parseOhms('green'), null)
})

test('parseFarads', () => {
  near(parseFarads('100n'), 100e-9, 1e-18)
  near(parseFarads('4.7u'), 4.7e-6, 1e-15)
  near(parseFarads('22p'), 22e-12, 1e-20)
  near(parseFarads('0.1u'), 0.1e-6, 1e-15)
  near(parseFarads('4n7'), 4.7e-9, 1e-18)
  near(parseFarads('10uF'), 10e-6, 1e-15)
  assert.equal(parseFarads('abc'), null)
})

test('formatValue', () => {
  assert.equal(formatValue(4700, 'Ω'), '4.7 kΩ')
  assert.equal(formatValue(330, 'Ω'), '330 Ω')
  assert.equal(formatValue(100e-9, 'F'), '100 nF')
})

test('E96 table: 96 values, ascending', () => {
  assert.equal(E96.length, 96)
  for (let i = 1; i < E96.length; i++) assert.ok(E96[i] > E96[i - 1])
})

test('eia96: samples from the standard table', () => {
  assert.equal(eia96(100), '01A')
  assert.equal(eia96(332), '51A')
  assert.equal(eia96(4750), '66B')
  assert.equal(eia96(4990), '68B')
  assert.equal(eia96(49.9), '68X')
  assert.equal(eia96(10000), '01C')
  assert.equal(eia96(976000), '96D')
  assert.equal(eia96(1.0), '01Y')
  assert.equal(eia96(330), null) // 330 is E24, not E96
})

test('resistorCode: three-digit EIA on 0603 without a tolerance', () => {
  assert.equal(resistorCode(330, '0603'), '331')
  assert.equal(resistorCode(4700, '0603'), '472')
  assert.equal(resistorCode(10, '0603'), '100')
  assert.equal(resistorCode(1e6, '0603'), '105')
  assert.equal(resistorCode(1, '0603'), '1R0')
  assert.equal(resistorCode(4.7, '0603'), '4R7')
  assert.equal(resistorCode(2.2, '0603', '5%'), '2R2')
  assert.equal(resistorCode(0.47, '0603'), 'R47')
})

test('resistorCode: EIA-96 on 1 percent 0603, three-digit fallback off the series', () => {
  assert.equal(resistorCode(100, '0603', '1%'), '01A')
  assert.equal(resistorCode(4750, '0603', '1%'), '66B')
  assert.equal(resistorCode(330, '0603', '1%'), '331')
  assert.equal(resistorCode(4750, '0603', '5%'), '482')
})

test('resistorCode: four-digit on 0805 and 1206 at 1 percent, the default', () => {
  assert.equal(resistorCode(330, '0805'), '3300')
  assert.equal(resistorCode(4700, '0805', '1%'), '4701')
  assert.equal(resistorCode(10, '1206'), '10R0')
  assert.equal(resistorCode(4.7, '1206'), '4R70')
  assert.equal(resistorCode(1e6, '1206'), '1004')
  assert.equal(resistorCode(4700, '1206', '5%'), '472')
})

test('resistorCode: jumpers and unmarked sizes', () => {
  assert.equal(resistorCode(0, '0603'), '0')
  assert.equal(resistorCode(0, '1206'), '0')
  assert.equal(resistorCode(330, '0402'), '')
  assert.equal(resistorCode(330, '0201', '1%'), '')
})
