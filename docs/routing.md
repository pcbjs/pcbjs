# Routing

`route(a)` and its chain: ends, path grammar, builder methods and corners, teardrops, autoroute parameters, net classes, pairs in short.
autorouter.md has how copper is placed, failures, keepouts, cache, locks and variants; pairs.md the pairs in full; length.md length targets and matching.

```tsx
{route(J1[3]).X(Q1[1]).width(0.25)}                                              // autorouted all the way
{route(J1[2]).Z(R1[1]).width(0.3)}                                               // one straight manual track
{route(J1[3]).V(14).L(5, 16).via('B.Cu').H(24).V(7.5).via('F.Cu').X(Q1[1]).width(0.25)} // manual, two vias, autorouted last hop
{route(Q1[2]).X('25 12.5 B.Cu').width(0.3)}                                      // to a point of the back pour
```

## The chain

| Call | Grammar | Does |
| --- | --- | --- |
| `.L(x, y)`, `.l(dx, dy)` | `L`, `l` | manual track to the point |
| `.H(x)`, `.h(dx)`, `.V(y)`, `.v(dy)` | `H`, `h`, `V`, `v` | manual track along x or y |
| `.via(layer)` | `@layer` | via at the cursor, continue on `layer` |
| `.Z(target)` | `Z` | straight manual track to the target |
| `.X(target)` | `X`, `XZ` | automatic leg to the target |

- Lengths are mm or unit strings, `'10mil'`. The last `.Z` or `.X` is the end `b`, required; an earlier one is a waypoint on the current layer, `'100mil 200mil'`, `[2.54, 5.08]` or a via, never a pin.
- A one-leg automatic route joins its net's copper where cheapest, growing a tree, autorouter.md Joins and loops.
- Compatibility form, never with a chain: `route(J1[3], Q1[1], 'V 14 L 5 16 @B.Cu XZ')`, `route(a, b, path?)`.

## Ends

| End | Example |
| --- | --- |
| pin or pad handle | `J1[3]`, `D1.A`, `J1['B4']`, `J1.pad('B4')` |
| via from `via()`, met on the arriving layer | layout.md Vias |
| `"REF.PIN"` string | `"J1.3"` |
| coordinate, first token a number | `"x y"`, `"x y layer"`, `[x, y, layer?]`, `{ at, layer? }` |
| pair | array ends |

The net comes from the pads, else a via end; pads on two nets are a compile error, coordinates alone need `.net(n)`. Type a helper's end as `RouteEnd` from `@pcbjs/core`.

## Path grammar

`L x y`, `H x`, `V y`, `X x y` automatic leg to a point, `@<layer>` or `@ <layer>` a via, `Z` or `z` straight to `b`, `XZ` or `X Z` automatic to `b`; lowercase `l`, `h`, `v`, `x` relative; mm.

- A hidden `M` starts at `a`; a missing end is `XZ`. `A`, `C`, `Q`, `S`, `T` and `M` are compile errors.
- `Z` must arrive on a layer of `b`: `@` first, or `XZ`.
- Layer aliases apply, `@bottom` is `@B.Cu`; `U <layer>` is the old spelling.
- Path and coordinate ends are in the enclosing `<g>` frame; pin handles are absolute.

## Builder methods

| Method | Default |
| --- | --- |
| `.width(mm)` | class width, else `minTrackWidth` |
| `.layer(name)`, start layer | the pad's layer, else `F.Cu` |
| `.layers([...])`, layers for automatic legs | autorouter.md Layers |
| `.vias(false)`, `.vias({ drill, size })` | allowed, default via |
| `.rules({ ... })`, any autoroute parameter | the board's |
| `.priority(n)` | 0; higher routes first |
| `.net(net)`, `.net(P, N)` | from the pads |
| `.lock()` | off; autorouter.md Cache and lock |
| `.direct()` | off; the leg joins no other copper of its net |
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
export default <PCB name="B" teardrops={{ pads: 'tht', length: 0.5, width: 0.9 }} />
```

- KiCad 7's straight teardrop: `length` past the pad edge, base `width` across the pad centre; a number is a fraction of the pad's smaller side, `'0.6mm'` a length. Bare `teardrops` takes the defaults; `pads` is `'tht'`, `'smd'` or `'all'`, the default; a class `teardrops: true` takes the board's.
- Net copper drawn after tuning, before pours; none on a track 0.9 of the pad side or wider. One breaking a clearance shrinks to 75%, 50%, else the info `teardrop-dropped`.

## Autoroute parameters

`<PCB autoroute={{ … }}>`, a preset, a variant target or `defineDefaultBoard`, merged by key; a route overrides with `.rules()` or the builder.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `algorithm` | `'maze'` | `'maze'`, `'straight'` that avoids nothing, or a custom `RouteFn` |
| `pitch` | width / 2, 0.05 to 0.1 | grid step in mm |
| `viaCost` | 5 | mm of track one via costs |
| `layers` | the ends' layers, widened | copper the router may use, first preferred |
| `via` | the default via | `{ drill, size }` of routed vias |
| `clearance` | 0.02 | extra mm over the rules around obstacles and the edge |
| `bend` | `'45'` | `'90'` forbids diagonals |
| `prefer` | none | `{ 'F.Cu': 'h', 'B.Cu': 'v' }`; across costs 1.5 times |
| `maxVias` | unlimited | per route |
| `avoid` | none | soft keepouts: points kept 0.5 mm clear or `{ x, y, w, h, layer? }` |
| `priority` | 0 | higher runs first |
| `viaInPad` | false | per route: a via may land in an SMD pad of the net |
| `ripup` | 12 | negotiation rounds, 0 off, autorouter.md |
| `maxDetour` | `{ ratio: 3, floor: 10 }` | a leg's limit: the larger of `ratio` times its straight line and line plus `floor` mm; a number sets the ratio, 0 off |
| `tune` | `{ amplitude: 1, spacing: 0.6, maxAmplitude: 3 }` | meander height, gap between runs, height limit, mm, length.md |

## Net classes

```tsx
import PCB from '@pcbjs/core'
const { VBUS } = nets({ VBUS: { class: 'power' } })
export default <PCB name="B" classes={{ power: { width: 0.5, clearance: 0.25 } }} />
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
| `corner` | none, a pair its pitch | `{ radius }`, a length or `'none'` |
| `teardrops` | the board's | `true`, an object, `false` |
| `loops` | false | loops intended, no `net-loop` |

- Route methods beat the class, the class the board. Start layer: `.layer()`, else the first pad's copper, F.Cu first.
- The router keeps the class clearance, so a class route draws no `clearance` finding of its own.
- A tag missing from the table is the ERC warning `net-class`; with no table, tags are labels.

## Differential pairs

```tsx
{route([U1.pad('1'), U1.pad('3')]).V(17.2).via('B.Cu').V(18.5).via('F.Cu').X([J2[3], J2[2]]).impedance(90)}
```

P first; the path is the centre line, offset into tracks `w + g` apart, a via pair per layer change; pairs.md, examples/highspeed.
