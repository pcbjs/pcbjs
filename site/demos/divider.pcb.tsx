// Divider: the layout of divider.sch.tsx, autorouted, for the home page of the site.
import PCB, { route } from '@pcbjs/core'
import { roundedRect } from '@pcbjs/lib'
import * as sch from './divider.sch'

export default (
  <PCB name="Divider" copper={2} schematic={sch}>
    <path layer="Edge.Cuts" d={roundedRect(20, 12, 1)} />
    <J1 at="3 3.46" />
    <R1 at="10 3" />
    <R2 at="10 9" />
    <C1 at="15 9" />
    {route(J1[2]).X(R1[1]).width(0.3)}
    {route(R1[2]).X(R2[1]).width(0.3)}
    {route(R2[1]).X(C1[1]).width(0.3)}
    {route(J1[3]).X(R2[1]).width(0.3)}
    {route(J1[1]).X(R2[2]).width(0.3)}
    {route(R2[2]).X(C1[2]).width(0.3)}
  </PCB>
)
