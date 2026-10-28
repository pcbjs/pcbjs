// Pour: a ground pour on the front, its pads joined by thermal spokes, for the home page of the site.
import PCB, { nets, pour, route } from '@pcbjs/core'
import { PinHeader, R0603, rect, roundedRect } from '@pcbjs/lib'

const { GND, VCC } = nets()
const J1 = PinHeader(2).connect(GND, VCC)
const R1 = R0603('10k').connect(VCC, GND)

export default (
  <PCB name="Pour" copper={2}>
    {/* #region show */}
    <path layer="Edge.Cuts" d={roundedRect(20, 12, 1)} />
    <J1 at="5 4.73" />
    <R1 at="13 6" />
    {route(J1[2]).H(9).X(R1[1]).width(0.3)}
    {pour(GND, 'F.Cu', rect(20, 12))}
    {/* #endregion show */}
  </PCB>
)
