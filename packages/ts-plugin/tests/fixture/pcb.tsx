import PCB, { route } from '@pcbjs/core'
import * as sch from './board.sch'

export default (
  <PCB name="Fixture" schematic={sch}>
    <U1 at="10 10" />
    {route(U1.VSSA).X(U1.PA0)}
  </PCB>
)
