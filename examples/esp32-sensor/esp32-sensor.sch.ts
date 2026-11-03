// ESP32 sensor node, the schematic: an ESP32-C3-MINI-1 powered and programmed over USB-C, a BME280 on I2C, reset and boot buttons, a status LED and a debug header.
// Each part is named by its constant; the LDO and the sensor block are circuits from lib/, instances 3 and 4, so their parts are U3, C31, C32 and U4, C4, R41, R42.
import { nets, NC } from '@pcbjs/core'
import { C0603, R0603, LED0603, PinHeader } from '@pcbjs/lib'
import { ESP32C3Mini, USBC, SOT23_6, Tact } from './lib/footprints'
import { schematic as ldo } from './lib/ldo'
import { schematic as bme280 } from './lib/bme280'

export const { GND, VBUS, V3V3, DP, DN, CC1, CC2, EN, BOOT, SDA, SCL, LED, TXD, RXD } = nets({ VBUS: { class: 'power' }, V3V3: { class: 'power' } })

// USB-C: power and native USB on IO18 and IO19, 5.1k pull-downs on CC for a 5 V sink, SBU unused, shell to GND
export const J1 = USBC().connect({ GND, VBUS, CC1, CC2, DP, DN, SBU1: NC, SBU2: NC, SHIELD: GND })
export const R1 = R0603('5k1').connect({ 1: CC1, 2: GND })
export const R2 = R0603('5k1').connect({ 1: CC2, 2: GND })
// ESD on the data pair and VBUS: USBLC6-2SC6, pins 1 and 6 one line, 3 and 4 the other
export const U2 = SOT23_6('USBLC6-2SC6').connect({ 1: DN, 2: GND, 3: DP, 4: DP, 5: VBUS, 6: DN })

// 3.3 V from VBUS
export const LDO = ldo({ VIN: VBUS, VOUT: V3V3, GND }, 'LDO3')

// the module and its decoupling: 10u bulk and 100n at the 3V3 pin
export const U1 = ESP32C3Mini().connect({
  GND,
  '3V3': V3V3,
  EN,
  IO0: NC,
  IO1: NC,
  IO2: NC,
  IO3: NC,
  IO4: SDA,
  IO5: SCL,
  IO6: NC,
  IO7: NC,
  IO8: LED,
  IO9: BOOT,
  IO10: NC,
  IO18: DN,
  IO19: DP,
  RXD0: RXD,
  TXD0: TXD,
})
export const C1 = C0603('10u').connect({ 1: V3V3, 2: GND })
export const C2 = C0603('100n').connect({ 1: V3V3, 2: GND })

// EN: 10k pull-up and 1u for the power-on delay, reset button to GND
export const R3 = R0603('10k').connect({ 1: V3V3, 2: EN })
export const C3 = C0603('1u').connect({ 1: EN, 2: GND })
export const SW1 = Tact('RESET').connect({ A: EN, B: GND })
// BOOT: IO9 has an internal pull-up; the button pulls it low
export const SW2 = Tact('BOOT').connect({ A: BOOT, B: GND })

// status LED on IO8, active low so the strap stays high at boot
export const R4 = R0603('1k').connect({ 1: V3V3, 2: LED })
export const D1 = LED0603('green').connect({ A: V3V3, K: LED })

// sensor block
export const SENS = bme280({ VDD: V3V3, GND, SDA, SCL }, 'SENS4')

// debug header: 3V3, GND, TX, RX, EN, BOOT
export const J2 = PinHeader(6)().connect({ 1: V3V3, 2: GND, 3: TXD, 4: RXD, 5: EN, 6: BOOT })
