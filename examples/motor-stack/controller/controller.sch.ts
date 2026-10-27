// Controller schematic: STM32G431CBT6, TJA1051T/3 CAN transceiver, 5 V to 3.3 V regulator, the board to board socket, SWD and test pads.
import { nets, NC } from '@pcbjs/core'
import { LQFP, SOIC, SOT23, R0603, R0402, C0603, C0402, LED0603, JST_XH, PinHeader, TestPad, Crystal3225, withPins } from '@pcbjs/lib'
import {
  GND, V5, V3V3, nHA, nLA, nHB, nLB, nHC, nLC, ISA, ISB, ISC, VSNS, nFAULT, SD, SWDIO, SWCLK, NRST, CANH, CANL,
} from '../lib/nets'
import { controllerSocket } from '../lib/header'
import { TEST_PADS } from '../lib/mech'

export { GND, V5, V3V3, SWDIO, SWCLK, NRST, CANH, CANL }
export const { OSC_IN, OSC_OUT, CAN_TX, CAN_RX, LED_K, LED_A, BOOT0 } = nets()

// STM32G431CBTx LQFP-48, pin names from KiCad's MCU_ST_STM32G4 symbol; supply pads of one name share a pin
export const G431_PINS = [
  'VBAT', 'PC13', 'PC14', 'PC15', 'PF0', 'PF1', 'PG10', 'PA0', 'PA1', 'PA2', 'PA3', 'PA4',
  'PA5', 'PA6', 'PA7', 'PB0', 'PB1', 'PB2', 'VSSA', 'VREF+', 'VDDA', 'PB10', 'VSS', 'VDD',
  'PB11', 'PB12', 'PB13', 'PB14', 'PB15', 'PA8', 'PA9', 'PA10', 'PA11', 'PA12', 'VSS', 'VDD',
  'PA13', 'PA14', 'PA15', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'PB8', 'PB9', 'VSS', 'VDD',
] as const
export const STM32G431 = LQFP(48, 7, 0.5, { pinNames: G431_PINS })

export const U1 = STM32G431('STM32G431CBT6', { MPN: 'STM32G431CBT6', Manufacturer: 'STMicroelectronics' }).connect({
  VBAT: V3V3, VDD: V3V3, VDDA: V3V3, 'VREF+': V3V3, VSS: GND, VSSA: GND,
  PF0: OSC_IN, PF1: OSC_OUT, PG10: NRST, PB8: BOOT0, PA13: SWDIO, PA14: SWCLK,
  PA8: nHA, PB13: nLA, PA9: nHB, PB14: nLB, PA10: nHC, PB15: nLC,   // TIM1 CH1 to CH3 and their complements
  PA1: ISA, PA7: ISB, PB0: ISC, PA0: VSNS,                            // OPAMP1 to OPAMP3 VINP, ADC1 IN1
  PB12: nFAULT, PB11: SD, PA11: CAN_RX, PA12: CAN_TX, PC13: LED_K,    // TIM1_BKIN, FDCAN1
  PC14: NC, PC15: NC, PA2: NC, PA3: NC, PA4: NC, PA5: NC, PA6: NC, PB1: NC, PB2: NC, PB10: NC,
  PA15: NC, PB3: NC, PB4: NC, PB5: NC, PB6: NC, PB7: NC, PB9: NC,
})

// TJA1051T/3: VIO at 3.3 V, S tied low for normal mode
export const CanXcvr = SOIC(8, 'N', { pinNames: ['TXD', 'GND', 'VCC', 'RXD', 'VIO', 'CANL', 'CANH', 'S'] })
export const U2 = CanXcvr('TJA1051T/3', { MPN: 'TJA1051T/3,118', Manufacturer: 'NXP' })
  .connect({ TXD: CAN_TX, GND, VCC: V5, RXD: CAN_RX, VIO: V3V3, CANL, CANH, S: GND })

// AP2112K-3.3, 600 mA, enabled from its input
export const Ldo = SOT23(5, { pinNames: ['VIN', 'GND', 'EN', 'NC', 'VOUT'] })
export const U3 = Ldo('AP2112K-3.3', { MPN: 'AP2112K-3.3TRG1', Manufacturer: 'Diodes' }).connect({ VIN: V5, GND, EN: V5, VOUT: V3V3 })

export const J1 = controllerSocket()
export const J2 = JST_XH(3, { value: 'B3B-XH-A', source: { MPN: 'B3B-XH-A(LF)(SN)', Manufacturer: 'JST' } }).connect(CANH, CANL, GND)
// Arm 10 pin Cortex debug, 1.27 mm: 1 VTref, 2 SWDIO, 3/5/9 GND, 4 SWCLK, 6 SWO, 7 key, 8 NC, 10 nRESET
export const J3 = PinHeader(5, { rows: 2, pitch: 1.27, value: 'FTSH-105-01-L-DV-K', source: { MPN: 'FTSH-105-01-L-DV-K', Manufacturer: 'Samtec' } })
  .connect({ 1: V3V3, 2: SWDIO, 3: GND, 4: SWCLK, 5: GND, 6: NC, 7: NC, 8: NC, 9: GND, 10: NRST })

export const Y1 = withPins(Crystal3225, { 2: 'GND1', 4: 'GND2' })('8MHz', { MPN: 'ABM8-8.000MHZ-B2-T', Manufacturer: 'Abracon' })
  .connect({ X1: OSC_IN, X2: OSC_OUT, GND1: GND, GND2: GND })
export const C_X1 = C0402('10p').connect(OSC_IN, GND)
export const C_X2 = C0402('10p').connect(OSC_OUT, GND)

// decoupling: one 100 nF per VDD pad, 1 uF on VDDA, bulk on the rail, the regulator's in and out, the transceiver's two supplies
export const C_VDD1 = C0402('100n').connect(V3V3, GND)
export const C_VDD2 = C0402('100n').connect(V3V3, GND)
export const C_VDD3 = C0402('100n').connect(V3V3, GND)
export const C_VDDA = C0402('1u').connect(V3V3, GND)
export const C_BULK = C0603('4.7u').connect(V3V3, GND)
export const C_LIN = C0603('1u').connect(V5, GND)
export const C_LOUT = C0603('1u').connect(V3V3, GND)
export const C_CVCC = C0402('100n').connect(V5, GND)
export const C_CVIO = C0402('100n').connect(V3V3, GND)
export const C_NRST = C0402('100n').connect(NRST, GND)

export const R_TERM = R0603('120').connect(CANH, CANL)
export const R_BOOT = R0402('10k').connect(BOOT0, GND)
export const R_FLT = R0402('10k').connect(V3V3, nFAULT)
export const R_SD = R0402('10k').connect(V3V3, SD)          // the bridge stays shut down until firmware drives SD low
export const R_LED = R0402('1k').connect(V3V3, LED_A)
export const D1 = LED0603('green').connect({ A: LED_A, K: LED_K })

// test pads on the back for the jig, one per entry of TEST_PADS
export const TP = TEST_PADS.map(t => TestPad(1.5)(t.name).connect(t.net))
