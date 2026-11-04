// DRC: a hand-drawn track that dips too close to a track of another net, for the home page of the site.
import PCB, { nets, route } from '@pcbjs/core'
import { PinHeader, R0603, roundedRect } from '@pcbjs/lib'

const { VCC, SIG } = nets()
const J1 = PinHeader(2)().connect({ 1: VCC, 2: SIG })
const R1 = R0603('10k').connect({ 1: SIG, 2: VCC })

export default (
  <PCB name="DRC">
    {/* #region show */}
    <path layer="Edge.Cuts" d={roundedRect(20, 12, 1)} />
    <J1 at="4 3.46" />
    <R1 at="13 6" />
    {route('4 6').net(SIG).width(0.3).H(12.2)}
    {route('4 3.46').net(VCC).width(0.3).H(8).V(5.6).H(11).V(3.46).H(13.83).V(6)}
    {/* #endregion show */}
  </PCB>
)
