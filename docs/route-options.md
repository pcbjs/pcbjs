# Route options

The builder methods of a route, teardrops, the autoroute parameters and net classes, each with its default.
Advanced. The route call and its chain are in routing.md; how the router uses these in autorouter.md.

## Builder methods

| Method | Default |
| --- | --- |
| `.width(mm)` | class width, else `minTrackWidth` |
| `.current(amps)` | none; checked against the width, routing.md |
| `.solver(fn)` | none; asked for each automatic leg first, autorouter.md |
| `.layer(name)`, start layer | the pad's layer, else `F.Cu` |
| `.layers([...])`, layers for automatic legs | autorouter.md Layers |
| `.vias(false)`, `.vias({ drill, size })` | allowed, default via |
| `.rules({ ... })`, the autoroute parameters without a method | the board's |
| `.priority(n)` | 0; higher routes first |
| `.net(net)`, `.net(P, N)`, `.net(null)` | from the pads |
| `.root(end)` | `route(NET)` only, its first pad |
| `.direct()` | off; the legs join no other copper of their net |
| `.loop()` | off; the net's loop is intended, no `net-loop` |
| `.impedance(ohms)` | none; width from the stackup for the start layer unless `.width()` |
| `.gap(mm)`, `.skew(mm)` | pairs only, pairs.md |
| `.length(mm)`, `.length({ min, max, target, tolerance })` | none, length.md |
| `.match(group, tolerance?)` | none, length.md |
| `.neck({ width, length })` | class `neck`, else on |
| `.corner(r)`, `.corner('none')` | class `corner`, else square; a pair rounds by its pitch |
| `.teardrops(false)`, `.teardrops({ … })` | class `teardrops`, else the board's |

- `.corner(r)` arcs manual corners on the centre line, shrinking to fit, then a 45 degree chamfer, else square; automatic legs keep the router's.
- Neck-down: where the route is too wide or crowds nearby pads, the pad's smaller side or `width`, at least `minTrackWidth`, for up to `length` mm, default 2; `{ length: 0 }` is off.

## Teardrops

```tsx
import PCB from '@pcbjs/core'
export default <PCB name="B" rev="0.1.0" teardrops={{ pads: 'tht', length: 0.5, width: 0.9 }} />
```

- KiCad 7's straight teardrop: `length` past the pad edge, base `width` across the pad centre; a number is a fraction of the pad's smaller side, `'0.6mm'` a length. Bare `teardrops` takes the defaults; `pads` is `'tht'`, `'smd'` or `'all'`, the default; a class `teardrops: true` takes the board's.
- Net copper drawn after tuning, before pours; none on a track 0.9 of the pad side or wider. One breaking a clearance shrinks to 75%, 50%, else the info `teardrop-dropped`.

## Autoroute parameters

`<PCB autoroute={{ … }}>`, a preset, a variant target or `defineDefaultBoard`, merged by key; a route overrides with its methods, and with `.rules()` for the rest.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `algorithm` | `'maze'` | `'maze'`, `'straight'` that avoids nothing, or a custom `RouteFn` |
| `pitch` | width / 2, 0.05 to 0.1 | grid step in mm |
| `viaCost` | 5 | mm of track one via costs |
| `layers` | the ends' layers, widened | copper the router may use, first preferred; `.layers()` on a route |
| `via` | the default via | `{ drill, size }` of routed vias; `.vias({ … })` on a route |
| `clearance` | 0.02 | extra mm over the rules around obstacles and the edge |
| `bend` | `'45'` | `'90'` forbids diagonals |
| `prefer` | none | `{ 'F.Cu': 'h', 'B.Cu': 'v' }`; across costs 1.5 times |
| `maxVias` | unlimited | per route; `.vias(false)` for none |
| `avoid` | none | soft keepouts: points kept 0.5 mm clear or `{ x, y, w, h, layer? }` |
| `priority` | 0 | higher runs first; `.priority()` on a route |
| `viaInPad` | false | per route: a via may land in an SMD pad of the net |
| `ripup` | 12 | negotiation rounds, 0 off, autorouter.md |
| `maxDetour` | `{ ratio: 3, floor: 10 }` | a leg's limit: the larger of `ratio` times its straight line and line plus `floor` mm; ratio 0 off |
| `tune` | `{ amplitude: 1, spacing: 0.6, maxAmplitude: 3 }` | meander height, gap between runs, height limit, mm, length.md |

## Net classes

```tsx
import PCB from '@pcbjs/core'
const { VBUS } = nets({ VBUS: { class: 'power' } })
export default <PCB name="B" rev="0.1.0" classes={{ power: { width: 0.5, clearance: 0.25 } }} />
```

Tag with `nets({ … })` or `bus(name, n, { class })`; define in `<PCB classes>`, a preset, a variant target or `defineDefaultBoard({ classes })`, merged by class then field.

| Field | Default | Meaning |
| --- | --- | --- |
| `width` | `minTrackWidth` | route width without `.width()` |
| `clearance` | the rules' | to other nets, the largest of rules and both classes; `{ track: 0.4 }` by kind, rules.md Overrides |
| `impedance` | none | ohms; without `width`, the start layer's width to 0.01 mm, stackup-and-rules.md |
| `via` | default via | `{ drill, size }` |
| `layers` | autorouter.md | router layers |
| `autoroute` | none | parameters over the board's |
| `gap` | the width | pair gap, edge to edge |
| `skew` | 0.1 | pair length difference, `pair-skew` |
| `uncoupled` | 5 | pair uncoupled length, `pair-uncoupled` |
| `tolerance` | 0.1 | for `.length(mm)` and `.match()` |
| `neck` | on, 2 mm | `{ width, length }` |
| `corner` | none, a pair its pitch | a radius or `'none'` |
| `teardrops` | the board's | `true`, an object, `false` |
| `loops` | false | loops intended, no `net-loop` |

- Route methods beat the class, the class the board. Start layer: `.layer()`, else the first pad's copper, F.Cu first.
- The router keeps the class clearance, so a class route draws no `clearance` finding of its own.
- A tag missing from the table is the ERC warning `net-class`; with no table, tags are labels.
