// Forms the demo does not use: drawn copper, a keepout, via options, arrays, negatives, units and builder chains.
import PCB, { keepout, route, pour, via } from '@pcbjs/core'
import { VCC, GND, J1, Q1, D1 } from './blinky.sch'

export default (
  <PCB name="Extras">
    {route('1 1').net(VCC).width(0.5).H(5)}
    {keepout('M 0 0 H 30 V 20 H 0 Z', { layers: ['B.Cu'] })}
    <pad num={1} at="-1.0mm 0.95mm" size={[0.9, 0.8]} drill={0.4} layers={['F.Cu', 'B.Cu']} />
    <text layer="F.SilkS" at={'2 3 90deg'} size={-1.5} thickness="0.2mm">X</text>
    <g at="0 5" side="bottom" />
    {via(VCC, '15.8 11.6', { drill: 0.3, size: 0.6 })}
    {via(GND, '1 2', { layers: ['F.Cu', 'In1.Cu'] })}
    {pour(GND, 'B.Cu', 'M 0 0 H 30 V 20 H 0 Z')}
    {route('3 10').net(GND).width(0.3).A(9, 10, 90)}
    {route('5 16 B.Cu', Q1[1]).width(0.2).X('4 4').X().layer('B.Cu').vias({ drill: 0.3, size: 0.6 })}
    {route(J1[1], D1['K'])}
  </PCB>
)
