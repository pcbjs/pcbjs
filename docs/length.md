# Length and matching

Length targets with `.length()`, match groups with `.match()`, how the tuner lays meanders to meet them, and where the lengths are reported.
The route call and its builder methods are in routing.md; pair skew is in pairs.md.

```tsx
route(J1[1]).Z(J2[1]).width(0.25).length(34)
route(J1[2]).Z(J2[2]).width(0.25).match('DATA')
route(J1[3]).H(20).V(14).H(35).Z(J2[3]).width(0.25).match('DATA')
```

| Call | Means |
| --- | --- |
| `.length(34)` | 34 mm within the class `tolerance`, else 0.1 mm |
| `.length({ min: 40, max: 42 })` | a range, either end optional |
| `.length({ target, tolerance })` | both |
| `.match('DATA', tolerance?)` | a group of routes, pairs or both, at its members' smallest tolerance |

- Length is `routeLength`: tracks along their arcs plus each via through the board; a pair's is its longer track.
- Order, before zones fill: targets in document order, groups by name, then pair skew. A short route goes to its target, else its range's middle, else its minimum plus half the tolerance.
- A group aims at its longest member, each shorter one into the window one tolerance below it within its own range; a member whose maximum is below caps the group, as `length-match` says.
- Meanders are one sided U bumps with arc corners of half the run pitch, down to the track width, 45 degree chamfers below twice the width. They go where the room beside a segment, clear of courtyards and silk, takes most, up to `maxAmplitude` per `tune`.
- One bump adds at least `2 pi - 4` times the width; less grows the last meander or overshoots within range.
- Too long is never shortened and no room stays short; the finding says by how much and why.
- Each step is cached in the route file. Tracks and vias carry `route`, `route:<n>` in document order; `board.routes` lists targets and tuning, `pcbjs inspect pcb.tsx --lengths` prints them.
