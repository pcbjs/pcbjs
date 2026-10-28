// Driver schematic: IR2133S three phase gate driver, three half bridges, the 12 V and 5 V regulators, bus sensing and the header.
import { nets, NC } from '@pcbjs/core'
import { SOIC, SOT223, withPins, R0603, C0603, C0805, C1206 } from '@pcbjs/lib'
import { VM, V12, V5, GND, nHA, nLA, nHB, nLB, nHC, nLC, ISA, ISB, ISC, VSNS, nFAULT, SD } from '../lib/nets'
import { driverHeader } from '../lib/header'
import { WirePad } from '../lib/footprints'
import { halfBridge } from './halfbridge.sch'

export { VM, V12, V5, GND }
export const { PHA, PHB, PHC, HOA, HOB, HOC, LOA, LOB, LOC, VBA, VBB, VBC, CAFB } = nets()

// IR2133S, SOIC-28W, pin names from KiCad's Driver_FET symbol; inputs and fault active low
export const IR2133S = SOIC(28, 'W', {
  pinNames: [
    'ITRIP',
    'nFLTCLR',
    'CAO',
    'CAm',
    'CAp',
    'SD',
    'VSS',
    'COM',
    'LO3',
    'LO2',
    'LO1',
    'VS3',
    'HO3',
    'VB3',
    'VS2',
    'HO2',
    'VB2',
    'VS1',
    'HO1',
    'VB1',
    'VCC',
    'nHIN1',
    'nHIN2',
    'nHIN3',
    'nLIN1',
    'nLIN2',
    'nLIN3',
    'nFAULT',
  ] as const,
})
export const U1 = IR2133S('IR2133SPBF', { MPN: 'IR2133SPBF', Manufacturer: 'Infineon' }).connect({
  ITRIP: GND,
  nFLTCLR: V5,
  CAO: CAFB,
  CAm: CAFB,
  CAp: GND,
  SD,
  VSS: GND,
  COM: GND,
  LO1: LOA,
  LO2: LOB,
  LO3: LOC,
  HO1: HOA,
  HO2: HOB,
  HO3: HOC,
  VS1: PHA,
  VS2: PHB,
  VS3: PHC,
  VB1: VBA,
  VB2: VBB,
  VB3: VBC,
  VCC: V12,
  nHIN1: nHA,
  nHIN2: nHB,
  nHIN3: nHC,
  nLIN1: nLA,
  nLIN2: nLB,
  nLIN3: nLC,
  nFAULT,
})

export const A = halfBridge({ VM, GND, V12, PH: PHA, HO: HOA, LO: LOA, VB: VBA, IS: ISA }, 'A')
export const B = halfBridge({ VM, GND, V12, PH: PHB, HO: HOB, LO: LOB, VB: VBB, IS: ISB }, 'B')
export const C = halfBridge({ VM, GND, V12, PH: PHC, HO: HOC, LO: LOC, VB: VBC, IS: ISC }, 'C')

// 24 V bus to 12 V for the gate driver, 12 V to 5 V for the controller
export const U2 = withPins(SOT223, ['IN', 'GND', 'OUT'])('UA78M12', { MPN: 'UA78M12IDCYR', Manufacturer: 'TI' }).connect({ IN: VM, GND, OUT: V12 })
export const U3 = withPins(SOT223, ['GND', 'OUT', 'IN'])('AMS1117-5.0', { MPN: 'AMS1117-5.0', Manufacturer: 'AMS' }).connect({ IN: V12, GND, OUT: V5 })
export const C_12IN = C0805('1u').connect(VM, GND)
export const C_12OUT = C0805('10u').connect(V12, GND)
export const C_5OUT = C0805('10u').connect(V5, GND)
export const C_VCC = C0603('1u').connect(V12, GND)
export const C_BULK = [0, 1, 2, 3].map(() => C1206('10u 50V', { MPN: 'GRM31CR71H106KA12L', Manufacturer: 'Murata' }).connect(VM, GND))

// bus divider, 24 V to 2.2 V
export const R_VT = R0603('100k').connect(VM, VSNS)
export const R_VB = R0603('10k').connect(VSNS, GND)
export const C_VS = C0603('10n').connect(VSNS, GND)

export const J1 = driverHeader()
export const J_VM = WirePad('VM').connect(VM)
export const J_GND = WirePad('GND').connect(GND)
export const J_A = WirePad('A').connect(PHA)
export const J_B = WirePad('B').connect(PHB)
export const J_C = WirePad('C').connect(PHC)
