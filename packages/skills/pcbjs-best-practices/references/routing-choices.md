# Hand routes or the router

pcbjs routes are chains: manual commands where you mean a path, `.X()` legs where the autorouter may choose. Both are code, so the choice can be revisited per route with numbers.

## When to keep a hand route

- It encodes a decision: a lane ladder, a 45 degree style, a bus kept on one layer, a return path under a signal, a skew budget already met.
- It came from a working board and nothing about it fails a rule.
- The router would pack it at minimum clearance where the hand route keeps room for rework or current.

## Trial before replacing

Swap one chain for an automatic leg in a scratch edit, check cold, compare, then decide:

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'

const { A, B } = nets()
const J1 = PinHeader(2).connect(A, B)
const J2 = PinHeader(2).connect(A, B)

export default (
  <PCB name="Trial">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={15} />
    <J1 at="3 5" />
    <J2 at="27 5" />
    {route(J1[1]).V(2).H(27).Z(J2[1]).width(0.3)}
    {route(J1[2]).layers(['F.Cu']).X(J2[2]).width(0.3)}
  </PCB>
)
```

`pcbjs inspect --lengths` gives both lengths; `pcbjs shot --layer F.Cu` shows both shapes. Keep the hand chain unless the router is shorter by a margin that matters and keeps every budget; write the numbers down either way.

## A timing budget on hand routes

A spec's skew budget becomes a match group with the budget as tolerance. DRC holds it on every compile, `inspect --lengths` prints the window, and if an edit breaks it the tuner meanders the short route back in.

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route, NC } from '@pcbjs/core'
import { PinHeader, SOIC } from '@pcbjs/lib'

const PS_PER_MM = 5.8               // FR-4 outer layer
const SKEW = +(60 / PS_PER_MM).toFixed(2)  // 60 ps budget, in mm
const { SCLK, MOSI } = nets()
const J1 = PinHeader(2).connect(SCLK, MOSI)
const U1 = SOIC(8)('driver').connect({ 1: NC, 2: NC, 3: SCLK, 4: MOSI, 5: NC, 6: NC, 7: NC, 8: NC })

export default (
  <PCB name="Budget">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <J1 at="3 5" />
    <U1 at="20 10" />
    {route(J1[1]).H(10).Z(U1[3]).match('SPI', SKEW)}
    {route(J1[2]).H(12).Z(U1[4]).match('SPI', SKEW)}
  </PCB>
)
```

Keep the tolerance at the real budget. A tight window makes the tuner add meanders to hand-drawn copper silently; the `tuned` column of `inspect --lengths` shows it.

## Rules of thumb

- `.lock()` an automatic leg once it is right; a locked leg never moves, and a collision then shows as a finding instead.
- A failed leg wants a waypoint into free board before anything else.
- A width from current: check the class width against the real current with IPC-2221 and write the numbers in a comment beside the class; change it only when the numbers say so.
- Routes made in helpers are attributed to the call site; keep helpers small so findings point somewhere useful.
