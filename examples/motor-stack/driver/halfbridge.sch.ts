// One phase of the bridge: two DPAK MOSFETs, a low side shunt, gate resistors, the bootstrap pair and the shunt's RC filter.
import { circuit, type Ports } from '@pcbjs/core'
import { R0603, C0603, C0805, chip } from '@pcbjs/lib'
import { DPAK, R2512 } from '../lib/footprints'

const FET = { MPN: 'IPD90N06S4-04', Manufacturer: 'Infineon' }
export const D1206 = chip('D', '1206', { names: ['K', 'A'], polarity: true })

export const halfBridge = circuit(
  'halfBridge',
  ({ VM, GND, V12, PH, HO, LO, VB, IS }: Ports<'VM' | 'GND' | 'V12' | 'PH' | 'HO' | 'LO' | 'VB' | 'IS'>, { nets: { gh, gl, sl } }) => ({
    QH: DPAK('IPD90N06S4-04', FET).connect({ G: gh, D: VM, S: PH }),
    QL: DPAK('IPD90N06S4-04', FET).connect({ G: gl, D: PH, S: sl }),
    RS: R2512('5m', { MPN: 'WSL2512R0050FEA', Manufacturer: 'Vishay' }).connect(GND, sl),
    RGH: R0603('10').connect(HO, gh),
    RGL: R0603('10').connect(LO, gl),
    DB: D1206('CD1206-B0540', { MPN: 'CD1206-B0540', Manufacturer: 'Bourns' }).connect({ A: V12, K: VB }),
    CB: C0805('1u').connect(VB, PH),
    RF: R0603('100').connect(IS, sl),
    CF: C0603('1n').connect(GND, IS),
  }),
)
