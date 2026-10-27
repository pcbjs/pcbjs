// Forms the demo does not use: the object forms of route, via and pour, arrays, negatives, units and builder chains.
import PCB, { route, pour, via } from '@pcbjs/core'
import { VCC, GND, J1, Q1 } from './blinky.sch'

export default (
  <PCB name="Extras" thickness={1.6}>
    <track net={VCC} layer="F.Cu" width={0.5} d="M 1 1 H 5" />
    <zone net={GND} layer='B.Cu' d={'M 0 0 H 30 V 20 H 0 Z'} />
    <pad num={1} at="-1.0mm 0.95mm" size={[0.9, 0.8]} drill={0.4} layers={['F.Cu', 'B.Cu']} />
    <text layer="silk" at={'2 3 90deg'} size={-1.5} thickness="0.2mm">X</text>
    <g at="0 5" side="bottom" />
    {via(VCC, '15.8 11.6', { drill: 0.3, size: 0.6 })}
    {via({ net: GND, at: '1 2', layers: ['F.Cu', 'In1.Cu'] })}
    {pour(GND, 'B.Cu', 'M 0 0 H 30 V 20 H 0 Z')}
    {route({ net: 'GND', layer: 'F.Cu', width: 0.3, d: 'M 3 10 H 9' })}
    {route('5 16 B.Cu', Q1[1], `X 4 4 XZ`).layer('B.Cu').vias({ drill: 0.3, size: 0.6 }).width(0.2)}
    {route(J1[1], 'D1.K')}
  </PCB>
)
