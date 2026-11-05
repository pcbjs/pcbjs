# Length matching and a pair

```tsx
import PCB from '@pcbjs/fab/JLCPCB/4-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'

const { CLK, D0, D1, GND } = nets()
const J1 = PinHeader(4)().connect({ 1: CLK, 2: D0, 3: D1, 4: GND })
const J2 = PinHeader(4)().connect({ 1: CLK, 2: D0, 3: D1, 4: GND })

export default (
  <PCB name="Matched" rev="0.1.0">
    <rect layer="Edge.Cuts" x={0} y={0} w={40} h={20} />
    <J1 at="5 5" />
    <J2 at="35 5" />
    {route(J1[1], J2[1]).width(0.2).length(32).Z()}
    {route(J1[2], J2[2]).width(0.2).match('DATA').Z()}
    {route(J1[3], J2[3]).width(0.2).match('DATA').H(20).V(16).H(32).V(10.08).Z()}
    {route(J1[4], J2[4]).width(0.3).layers(['In1.Cu', 'B.Cu'])}
  </PCB>
)
```

`pcbjs inspect --lengths` prints each route with its length, target, group, skew, what tuning added and its status. A differential pair is `route([P, N])` with array ends, see `pcbjs docs pairs`.
