// Divider, the schematic: a header feeding a resistor divider with a filter cap, for the home page of the site.
import { nets, Schematic } from '@pcbjs/core'
import { PinHeader, R0603, C0603 } from '@pcbjs/lib'

export const { GND, VIN, OUT } = nets()
export const J1 = PinHeader(3).connect(GND, VIN, OUT)
export const R1 = R0603('10k').connect(VIN, OUT)
export const R2 = R0603('4k7').connect(OUT, GND)
export const C1 = C0603('100n').connect(OUT, GND)

// #region show
export const drawing = (
  <Schematic>
    <J1 at="3 6" />
    <R1 at="10 3" rot={90} />
    <R2 at="10 9" rot={90} />
    <C1 at="15 9" rot={90} />
  </Schematic>
)
// #endregion show
