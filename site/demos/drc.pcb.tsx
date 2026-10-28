// DRC: a hand-drawn track that dips too close to a track of another net, for the home page of the site.
import PCB, { nets, route } from '@pcbjs/core'
import { PinHeader, R0603, roundedRect } from '@pcbjs/lib'

const { VCC, SIG } = nets()
const J1 = PinHeader(2).connect(VCC, SIG)
const R1 = R0603('10k').connect(SIG, VCC)

export default (
  <PCB name="DRC" copper={2}>
    {/* #region show */}
    <path layer="Edge.Cuts" d={roundedRect(20, 12, 1)} />
    <J1 at="4 3.46" />
    <R1 at="13 6" />
    {route(SIG, { width: 0.3, d: 'M 4 6 H 12.2' })}
    {route(VCC, { width: 0.3, d: 'M 4 3.46 H 8 V 5.6 H 11 V 3.46 H 13.83 V 6' })}
    {/* #endregion show */}
  </PCB>
)
