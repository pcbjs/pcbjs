// A 3.3 V LDO stage: AP2112K-3.3 with its input and output capacitors, enable tied to the input.
// Ports: VIN, VOUT and GND. Pin 4 of the AP2112K is NC.
import { circuit, NC, type Ports } from '@pcbjs/core'
import { C0603 } from '@pcbjs/lib'
import { SOT23_5 } from './footprints'

export const ldo = circuit('ldo', ({ VIN, VOUT, GND }: Ports<'VIN' | 'VOUT' | 'GND'>) => ({
  U: SOT23_5('AP2112K-3.3', { MPN: 'AP2112K-3.3TRG1', 'MPN:LCSC': 'C51118', Manufacturer: 'Diodes' }).connect(VIN, GND, VIN, NC, VOUT),
  CIN: C0603('1u').connect(VIN, GND),
  COUT: C0603('1u').connect(VOUT, GND),
}))
