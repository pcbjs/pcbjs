// One column of the power stage, high side on top: QH, QL, the shunt, then the bootstrap pair. Local frame: x 0 is the column centre, y 0 the board's top edge.
import { layout, route, pour, via, keepout } from '@pcbjs/core'
import { rect } from '@pcbjs/lib'
import { halfBridge } from './halfbridge.sch'

export const HalfBridgeColumn = layout(halfBridge, (g, { at }) => (
  <g at={at}>
    <g.QH at="0 9 90deg" />
    <g.QL at="0 22 90deg" />
    <g.RS at="2.28 32.5 90deg" />
    <g.RGH at="-4.7 15.5 90deg" />
    <g.RGL at="-4.7 28.5 90deg" />
    <g.RF at="-2.2 32.5 90deg" />
    <g.CF at="-2.2 36 90deg" />
    <g.CB at="-4 44 90deg" />
    <g.DB at="-4 48.5 -90deg" />

    {/* the phase node: QH source and the QL tab poured on top, a strip on the back down to the phase wire pad */}
    {pour(g.ports.PH, 'F.Cu', rect(7, 11.4, -3.5, 12.6), { priority: 2, connect: 'solid' })}
    {pour(g.ports.PH, 'B.Cu', rect(5, 46, -2.5, 12), { priority: 2, connect: 'solid' })}
    {/* the QH source corner of the F.Cu pour is cut off from the QL tab by the gate tracks: a via down to the strip */}
    {via(g.ports.PH, '1.2 14', { drill: 0.3, size: 0.6 })}
    {/* no signal tracks across the phase strip below the tab: crossing it on B.Cu cut the phase current's path in two */}
    {keepout('B.Cu', rect(5, 18, -2.5, 23), { vias: false, pours: false })}
    {[[-1.6, 18.8], [0, 18.8], [1.6, 18.8], [-1.6, 21], [0, 21], [1.6, 21], [-1.6, 23.2], [0, 23.2], [1.6, 23.2]].map(([x, y]) => via(g.ports.PH, `${x} ${y}`, { drill: 0.4, size: 0.8 }))}

    {/* QL source into the shunt, the shunt's sense end through the RC filter */}
    {route(g.QL.S).Z(g.RS[2]).width(2)}
    {route(g.RS[2]).X(g.RF[2]).width(0.3)}
    {route(g.RF[1]).Z(g.CF[2]).width(0.3)}
    {route(g.RGH[2]).X(g.QH.G).width(0.5)}
    {route(g.RGL[2]).X(g.QL.G).width(0.5)}
    {route(g.DB.K).Z(g.CB[1]).width(0.5)}
    {route(g.CB[2]).X('0 43 B.Cu').width(0.5)}
  </g>
), 'HalfBridgeColumn')
