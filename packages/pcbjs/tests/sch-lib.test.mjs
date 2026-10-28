// Every standard library factory has a default schematic symbol: passives, diodes, LEDs, transistors, crystals, switches,
// batteries and test points by their own symbols, connectors as a pin row, anything else as a generic box.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partOf } from '@pcbjs/core/schematic'
import { autoSymbol } from '@pcbjs/core/sch-symbol'
import * as lib from '@pcbjs/lib'

const kind = part => {
  const st = partOf(part)
  return autoSymbol({ prefix: st.prefix, pins: st.pins, id: st.footprintId, value: st.value }).kind
}

test('the default symbol of each standard library factory', () => {
  const cases = [
    [lib.R0603('1k'), 'resistor'],
    [lib.R0402('1k'), 'resistor'],
    [lib.C0603('1u'), 'capacitor'],
    [lib.chip('L', '1206')('2u2'), 'inductor'],
    [lib.LED0603('red'), 'led'],
    [lib.LED('0805', 'blue')('x'), 'led'],
    [lib.chip('D', '0603')('1N4148'), 'diode'],
    [lib.SOT23(3)('MMBT3904'), 'npn'],
    [lib.SOT23(3)('2N7002'), 'nfet'],
    [lib.Crystal3225('16M'), 'crystal'],
    [lib.Crystal2012('32k'), 'crystal'],
    [lib.TactSwitch()('x'), 'switch'],
    [lib.CR2032Holder('x'), 'battery'],
    [lib.TestPad()('x'), 'testpoint'],
    [lib.PinHeader(4), 'connector'],
    [lib.JST_PH(2), 'connector'],
    [lib.SOIC(8)('x'), 'box'],
    [lib.SOT223('x'), 'box'],
    [lib.WS2812B()('x'), 'box'],
    [lib.ESP32C3Mini1('x'), 'box'],
    [lib.USBC('full16', 'x'), 'box'],
  ]
  for (const [p, k] of cases) assert.equal(kind(p), k, `${partOf(p).label} ${partOf(p).prefix} ${partOf(p).pins.join(',')}`)
})

test('the generic box puts supplies on top, grounds at the bottom, outputs right', () => {
  const s = autoSymbol({ prefix: 'U', pins: ['VDD', 'GND', 'IN', 'OUT', 'EN', 'EP'] })
  const side = n => s.pins.find(p => p.name === n).side
  assert.deepEqual(['VDD', 'GND', 'IN', 'OUT', 'EN', 'EP'].map(side), ['top', 'bottom', 'left', 'right', 'left', 'bottom'])
  for (const p of s.pins) assert.ok(Number.isInteger(p.end[0]) && Number.isInteger(p.end[1]), 'pin ends on the grid')
})
