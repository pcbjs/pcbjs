// stm32-dev, the schematic: an STM32F103C8 with USB-C power and data, 8 MHz and 32.768 kHz crystals, SWD, reset and boot buttons,
// two LEDs and every free GPIO on two 19-pin headers. Supply pins each get a 100 nF capacitor on the back.
// Each part is named by its constant; the circuit parts take their instance index, so the regulator of LDO2 is U21.
import { nets, type Net } from '@pcbjs/core'
import { C0603, R0603, LED0603, PinHeader } from '@pcbjs/lib'
import { STM32F103C8, Tact } from './lib/parts'
import { ldo, hse, lse, usbc } from './lib/power.sch'

export const { GND, VBUS, V3V3, NRST, BOOT0, OSC_IN, OSC_OUT, OSC32_IN, OSC32_OUT, USB_DP, USB_DN, SWDIO, SWCLK, LED_PWR, LED_USR } = nets()

// the GPIOs that reach a header, in the order the headers list them
export const TOP_IO = ['PA0', 'PC13', 'PB9', 'PB8', 'PB7', 'PB6', 'PB5', 'PB4', 'PB3', 'PA15'] as const
export const BOTTOM_IO = ['PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7', 'PB0', 'PB1', 'PB2', 'PB10', 'PB11', 'PB12', 'PB13', 'PB14', 'PB15', 'PA8', 'PA9', 'PA10'] as const
type Io = (typeof TOP_IO)[number] | (typeof BOTTOM_IO)[number]
const io = nets()
export const IO = Object.fromEntries([...TOP_IO, ...BOTTOM_IO].map(p => [p, io[p]])) as Record<Io, Net>

export const U1 = STM32F103C8('STM32F103C8T6').connect({
  ...IO,
  VBAT: V3V3,
  VDDA: V3V3,
  VDD_1: V3V3,
  VDD_2: V3V3,
  VDD_3: V3V3,
  VSSA: GND,
  VSS_1: GND,
  VSS_2: GND,
  VSS_3: GND,
  OSC_IN,
  OSC_OUT,
  PC14: OSC32_IN,
  PC15: OSC32_OUT,
  NRST,
  BOOT0,
  PA11: USB_DN,
  PA12: USB_DP,
  PA13: SWDIO,
  PA14: SWCLK,
})

// power, clocks and USB
export const USB = usbc({ VBUS, DP: USB_DP, DN: USB_DN, GND }, 'USB1')
export const LDO = ldo({ VIN: VBUS, VOUT: V3V3, GND }, 'LDO2')
export const HSE = hse({ XIN: OSC_IN, XOUT: OSC_OUT, GND }, 'HSE3')
export const LSE = lse({ XIN: OSC32_IN, XOUT: OSC32_OUT, GND }, 'LSE4')
export const R3 = R0603('1k5').connect({ 1: V3V3, 2: USB_DP }) // full-speed pull-up on D+

// one 100 nF per supply pin, on the back under the package: C7 VBAT, C8 VDDA, C9 to C11 VDD_1 to VDD_3
export const C7 = C0603('100n').connect({ 1: V3V3, 2: GND })
export const C8 = C0603('100n').connect({ 1: V3V3, 2: GND })
export const C9 = C0603('100n').connect({ 1: V3V3, 2: GND })
export const C10 = C0603('100n').connect({ 1: V3V3, 2: GND })
export const C11 = C0603('100n').connect({ 1: V3V3, 2: GND })

// reset and boot: SW1 resets, SW2 pulls BOOT0 high, R4 and R5 hold BOOT0 and BOOT1 low
export const SW1 = Tact('RESET').connect({ 1: NRST, 2: GND })
export const C12 = C0603('100n').connect({ 1: NRST, 2: GND })
export const SW2 = Tact('BOOT0').connect({ 1: BOOT0, 2: V3V3 })
export const R4 = R0603('10k').connect({ 1: BOOT0, 2: GND })
export const R5 = R0603('10k').connect({ 1: IO.PB2, 2: GND })

// LEDs: D1 power on 3V3, D2 user on PC13, active low
export const R6 = R0603('1k').connect({ 1: V3V3, 2: LED_PWR })
export const D1 = LED0603('red').connect({ A: LED_PWR, K: GND })
export const R7 = R0603('1k').connect({ 1: V3V3, 2: LED_USR })
export const D2 = LED0603('green').connect({ A: LED_USR, K: IO.PC13 })

// connectors: J2 SWD on the left edge, J3 and J4 the GPIO rows on the long edges, pin 1 on the left
export const J2 = PinHeader(5)().connect({ 1: V3V3, 2: SWCLK, 3: GND, 4: SWDIO, 5: NRST })
export const J3 = PinHeader(19)().connect({
  1: GND,
  2: V3V3,
  3: IO.PA0,
  4: NRST,
  5: IO.PC13,
  6: IO.PB9,
  7: IO.PB8,
  8: IO.PB7,
  9: IO.PB6,
  10: IO.PB5,
  11: IO.PB4,
  12: IO.PB3,
  13: IO.PA15,
  14: SWCLK,
  15: SWDIO,
  16: V3V3,
  17: GND,
  18: VBUS,
  19: GND,
})
export const J4 = PinHeader(19)().connect(Object.fromEntries(BOTTOM_IO.map((p, i) => [i + 1, IO[p]])))
