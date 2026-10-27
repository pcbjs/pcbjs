# Length and matching

Length targets with `.length()`, match groups with `.match()`, how the tuner lays meanders to meet them, and where the lengths are reported.
The route call and its builder methods are in routing.md; pair skew is in pairs.md.

## Targets and groups

```tsx
import PCB, { nets, route } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'

const { CLK, D0, D1 } = nets()
const J1 = PinHeader(3).connect(CLK, D0, D1)
const J2 = PinHeader(3).connect(CLK, D0, D1)

export default () => (
  <PCB name="Tuned">
    <rect layer="Edge.Cuts" x={0} y={0} w={40} h={20} />
    <J1 at="5 5" />
    <J2 at="35 5" />
    {route(J1[1]).Z(J2[1]).width(0.25).length(34)}
    {route(J1[2]).Z(J2[2]).width(0.25).match('DATA')}
    {route(J1[3]).H(20).V(14).H(35).Z(J2[3]).width(0.25).match('DATA')}
  </PCB>
)
```

- `.length(34)` is 34 mm give or take the class `tolerance`, else 0.1 mm; `.length({ min: 40, max: 42 })` a range, either end optional; `.length({ target, tolerance })` both.
- `.match('DATA', tolerance?)` puts the route in a group of routes, pairs or both, with the smallest tolerance of its members, each its own, the class's or 0.1 mm.
- The length is `routeLength`: the tracks, along their arcs, and each via's distance through the board. A pair's length is its longer track.
- Tuning runs before zones fill: targets in document order, groups by name, then pair skew. A route short of its minimum goes to its target, else the middle of its range, else its minimum and half the tolerance.
- A group aims at its longest route: a member more than the tolerance below it goes into the window from the longest less the tolerance to the longest, within its own range. A member whose maximum is below that window goes to its maximum and caps the group, as `length-match` says.
- The meander is a one sided serpentine of U bumps, corners arcs of half the run pitch, down to the track width where room is short, below twice the width 45 degree chamfers. It goes where the room beside a segment, clear of other parts' courtyards and silk, takes the most, and per `tune` grows up to `maxAmplitude` or shrinks to half the run pitch.
- A U bump adds at least `2 pi - 4` times the track width. Less than that grows the last meander, or one smallest bump overshoots within the range; else the route stays short and the finding says so.
- A route too long is never shortened; one without room stays short, the finding says by how much and why.
- Each tuning step is cached in the route file.
- Every track and via of a route carries `route`, `route:<n>` in document order; `board.routes` lists them with their targets and what tuning added, `pcbjs inspect pcb.tsx --lengths` prints them.
