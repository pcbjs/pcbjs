// Route: a hand-drawn chain and a leg left to the autorouter, for the home page of the site.
import PCB, { nets, route } from '@pcbjs/core'
import { PinHeader, R0603, LED0603, roundedRect } from '@pcbjs/lib'

const { GND, VCC, LED } = nets()
const J1 = PinHeader(2)().connect({ 1: GND, 2: VCC })
const R1 = R0603('330').connect({ 1: VCC, 2: LED })
const D1 = LED0603('green').connect({ A: LED, K: GND })

export default (
  <PCB name="Route">
    {/* #region show */}
    <path layer="Edge.Cuts" d={roundedRect(20, 12, 1)} />
    <J1 at="3 4.73" />
    <R1 at="10 3.5" />
    <D1 at="16 6 90deg" />
    {route(J1[2], R1[1]).width(0.3).H(6).V(3.5)}
    {route(R1[2], D1.A).width(0.3).H(16)}
    {route(D1.K, J1[1]).width(0.3)}
    {/* #endregion show */}
  </PCB>
)
