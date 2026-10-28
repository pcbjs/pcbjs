// sdram, the schematic: an STM32F429ZI with a 16-bit SDRAM on its FMC, a 25 MHz crystal, a 3.3 V LDO from USB-C VBUS,
// USB full speed on PA11 and PA12, a reset button, a BOOT0 jumper header and one 100 nF capacitor per supply pin.
// The FMC pin map is the one of ST's STM32F429I-DISCO: SDNE0 and SDCKE0 on PC2 and PC3. The data nets D0 to D15 are the FMC
// data bits. Within each byte lane they reach the SDRAM pins in the order the layout needs, RAM_DQ below: an SDRAM stores
// whatever bit order it is given, the mode register goes over the address lines, so a swap inside a lane is free.
import { nets, bus, NC, type Net } from '@pcbjs/core'
import { C0402, C0603, C0805, R0603, PinHeader, USBC, TactSwitch, Crystal3225 } from '@pcbjs/lib'
import { STM32F429, F429_LQFP144_PINS, SDRAM_TSOP54, AMS1117 } from './lib/parts'

const SD = { class: 'sdram' }
export const D = bus('D', 16, SD)
// SDRAM pin DQi takes FMC data bit RAM_DQ[i]: lane 0 on DQ0 to DQ7 with LDQM, lane 1 on DQ8 to DQ15 with UDQM
export const RAM_DQ = [4, 5, 6, 7, 0, 1, 2, 3, 15, 14, 13, 12, 11, 10, 9, 8] as const
export const A = bus('A', 13, SD)
export const { BA0, BA1, SDCLK, SDCKE, SDNE, SDNRAS, SDNCAS, SDNWE, NBL0, NBL1 } = nets({
  BA0: SD,
  BA1: SD,
  SDCLK: SD,
  SDCKE: SD,
  SDNE: SD,
  SDNRAS: SD,
  SDNCAS: SD,
  SDNWE: SD,
  NBL0: SD,
  NBL1: SD,
})
export const { GND, VBUS, V3V3, VCAP1, VCAP2, NRST, BOOT0, OSC_IN, OSC_OUT, CC1, CC2 } = nets()
export const { USB_DP, USB_DN } = nets({ USB_DP: { class: 'usb' }, USB_DN: { class: 'usb' } })

// the FMC SDRAM pins of the F429
const FMC: Record<string, Net> = {
  PD14: D[0],
  PD15: D[1],
  PD0: D[2],
  PD1: D[3],
  PE7: D[4],
  PE8: D[5],
  PE9: D[6],
  PE10: D[7],
  PE11: D[8],
  PE12: D[9],
  PE13: D[10],
  PE14: D[11],
  PE15: D[12],
  PD8: D[13],
  PD9: D[14],
  PD10: D[15],
  PF0: A[0],
  PF1: A[1],
  PF2: A[2],
  PF3: A[3],
  PF4: A[4],
  PF5: A[5],
  PF12: A[6],
  PF13: A[7],
  PF14: A[8],
  PF15: A[9],
  PG0: A[10],
  PG1: A[11],
  PG2: A[12],
  PG4: BA0,
  PG5: BA1,
  PG8: SDCLK,
  PG15: SDNCAS,
  PF11: SDNRAS,
  PC0: SDNWE,
  PC2: SDNE,
  PC3: SDCKE,
  PE0: NBL0,
  PE1: NBL1,
}
const USED: Record<string, Net> = {
  ...FMC,
  VDD: V3V3,
  VBAT: V3V3,
  VDDA: V3V3,
  VREF: V3V3,
  PDR_ON: V3V3,
  VSS: GND,
  VSSA: GND,
  VCAP1,
  VCAP2,
  PH0: OSC_IN,
  PH1: OSC_OUT,
  NRST,
  BOOT0,
  PA11: USB_DN,
  PA12: USB_DP,
}
type McuPin = (typeof F429_LQFP144_PINS)[number]
// every GPIO the board does not use is left open on purpose
const pins = Object.fromEntries(F429_LQFP144_PINS.map(p => [p, USED[p] ?? NC])) as Record<McuPin, Net | typeof NC>
export const U1 = STM32F429('STM32F429ZIT6').source({ MPN: 'STM32F429ZIT6', Manufacturer: 'STMicroelectronics' }).connect(pins)

export const U2 = SDRAM_TSOP54('W9825G6KH-6I')
  .source({ MPN: 'W9825G6KH-6I', Manufacturer: 'Winbond', 'MPN:LCSC': 'C62379' })
  .connect({
    ...Object.fromEntries(RAM_DQ.map((bit, i) => [`DQ${i}`, D[bit]])),
    ...Object.fromEntries(A.map((n, i) => [`A${i}`, n])),
    BA0,
    BA1,
    CLK: SDCLK,
    CKE: SDCKE,
    CS: SDNE,
    RAS: SDNRAS,
    CAS: SDNCAS,
    WE: SDNWE,
    LDQM: NBL0,
    UDQM: NBL1,
    VDD: V3V3,
    VDDQ: V3V3,
    VSS: GND,
    VSSQ: GND,
  } as any)

// USB-C for power and full-speed data, 5.1k pull-downs on CC for a 5 V sink
export const J1 = USBC('full16', 'TYPE-C-31-M-12')
  .source({ MPN: 'TYPE-C-31-M-12', Manufacturer: 'HRO', 'MPN:LCSC': 'C165948' })
  .connect({ GND, VBUS, CC1, CC2, DP: USB_DP, DN: USB_DN, SBU1: NC, SBU2: NC, SHIELD: GND })
export const R_CC1 = R0603('5k1').connect(CC1, GND)
export const R_CC2 = R0603('5k1').connect(CC2, GND)

// 3.3 V LDO
export const U3 = AMS1117('AMS1117-3.3').source({ MPN: 'AMS1117-3.3', Manufacturer: 'AMS', 'MPN:LCSC': 'C6186' }).connect({ VIN: VBUS, GND, VOUT: V3V3 })
export const C_IN = C0805('10u').connect(VBUS, GND)
export const C_OUT = C0805('22u').connect(V3V3, GND)

// 25 MHz HSE crystal with its load capacitors
export const Y1 = Crystal3225('25MHz').source({ MPN: 'X322525MOB4SI', Manufacturer: 'Yangxing' }).connect({ X1: OSC_IN, X2: OSC_OUT, GND })
export const C_X1 = C0603('12p').connect(OSC_IN, GND)
export const C_X2 = C0603('12p').connect(OSC_OUT, GND)

// reset button and the BOOT0 jumper: 1-2 boots from the system loader, 2-3 from flash; the pull-down holds BOOT0 low when open
export const SW1 = TactSwitch('5.1x5.1')('RESET').source({ MPN: 'TS-1187A-B-A-B', Manufacturer: 'XKB', 'MPN:LCSC': 'C318884' }).connect({ A: NRST, B: GND })
export const C_RST = C0603('100n').connect(NRST, GND)
export const J2 = PinHeader(3).source({ MPN: 'PZ254V-11-03P' }).connect(V3V3, BOOT0, GND)
export const R_BOOT = R0603('10k').connect(BOOT0, GND)

// decoupling: one 100 nF per MCU supply pin, 12 VDD, VBAT, and one for VDDA and VREF+ which sit side by side, 2.2 uF on each VCAP, one 100 nF per SDRAM supply pin
export const C_MCU = Array.from({ length: 14 }, () => C0402('100n').connect(V3V3, GND))
export const C_VCAP1 = C0402('2.2u').connect(VCAP1, GND)
export const C_VCAP2 = C0402('2.2u').connect(VCAP2, GND)
export const C_RAM = Array.from({ length: 7 }, () => C0603('100n').connect(V3V3, GND))
