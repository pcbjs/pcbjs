// stm32-dev, the schematic: an STM32F103C8 with USB-C power and data, 8 MHz and 32.768 kHz crystals, SWD, reset and boot buttons,
// two LEDs and every free GPIO on two 19-pin headers. Supply pins each get a 100 nF capacitor on the back.
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
export const USB = usbc({ VBUS, DP: USB_DP, DN: USB_DN, GND }, 'USB')
export const LDO = ldo({ VIN: VBUS, VOUT: V3V3, GND }, 'LDO')
export const HSE = hse({ XIN: OSC_IN, XOUT: OSC_OUT, GND }, 'HSE')
export const LSE = lse({ XIN: OSC32_IN, XOUT: OSC32_OUT, GND }, 'LSE')
export const R_DP = R0603('1k5').connect(V3V3, USB_DP) // full-speed pull-up on D+

// one 100 nF per supply pin, on the back under the package
export const C_VBAT = C0603('100n').connect(V3V3, GND)
export const C_VDDA = C0603('100n').connect(V3V3, GND)
export const C_VDD1 = C0603('100n').connect(V3V3, GND)
export const C_VDD2 = C0603('100n').connect(V3V3, GND)
export const C_VDD3 = C0603('100n').connect(V3V3, GND)

// reset and boot
export const SW_RST = Tact('RESET').connect(NRST, GND)
export const C_NRST = C0603('100n').connect(NRST, GND)
export const SW_BOOT = Tact('BOOT0').connect(BOOT0, V3V3)
export const R_BOOT0 = R0603('10k').connect(BOOT0, GND)
export const R_BOOT1 = R0603('10k').connect(IO.PB2, GND)

// LEDs: power on 3V3, user on PC13 (active low)
export const R_LED1 = R0603('1k').connect(V3V3, LED_PWR)
export const D_PWR = LED0603('red').connect({ A: LED_PWR, K: GND })
export const R_LED2 = R0603('1k').connect(V3V3, LED_USR)
export const D_USR = LED0603('green').connect({ A: LED_USR, K: IO.PC13 })

// connectors: SWD on the left edge, the two GPIO rows on the long edges, pin 1 on the left
export const J_SWD = PinHeader(5).connect(V3V3, SWCLK, GND, SWDIO, NRST)
export const J_TOP = PinHeader(19).connect(GND, V3V3, IO.PA0, NRST, IO.PC13, IO.PB9, IO.PB8, IO.PB7, IO.PB6, IO.PB5, IO.PB4, IO.PB3, IO.PA15, SWCLK, SWDIO, V3V3, GND, VBUS, GND)
export const J_BOT = PinHeader(19).connect(...BOTTOM_IO.map(p => IO[p]))
