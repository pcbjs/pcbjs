# Routing

`route(a)` and its chain: route ends, the path grammar, the builder methods and corners, teardrops, the autoroute parameters, net classes and pairs in short.
How the autorouter places copper, its failures, keepouts, the cache and locks and variants are in autorouter.md; pairs.md has the pairs in full; length.md has length targets and matching.

## The route call

```tsx
{route(J1[3]).X(Q1[1]).width(0.25)}                                              // autorouted all the way
{route(J1[2]).Z(R1[1]).width(0.3)}                                               // one straight manual track
{route(J1[3]).V(14).L(5, 16).via('B.Cu').H(24).V(7.5).via('F.Cu').X(Q1[1]).width(0.25)} // manual, two vias, autorouted last hop
{route(Q1[2]).X('25 12.5 B.Cu').width(0.3)}                                      // to a point of the back pour
```

`route(a)` starts at `a`, and each call of its chain adds one command of the path grammar below and returns the route:

| Call | Grammar | Does |
| --- | --- | --- |
| `.L(x, y)`, `.l(dx, dy)` | `L`, `l` | a manual track to the point |
| `.H(x)`, `.h(dx)`, `.V(y)`, `.v(dy)` | `H`, `h`, `V`, `v` | a manual track along x or y |
| `.via(layer)` | `@layer` | a via at the cursor, the route goes on on `layer` |
| `.Z(target)` | `Z` | a straight manual track to the target |
| `.X(target)` | `X`, `XZ` | an automatic leg to the target |

- Lengths are numbers in mm or strings with units, such as `'10mil'`.
- The last `.Z` or `.X` is the end `b`, an earlier one a waypoint: a position such as `'100mil 200mil'` or `[2.54, 5.08]` or a via, never a pin. A chain without an end is a compile error. A waypoint has no layer of its own: it is on the layer the chain is on, changed with `.via(layer)` before it.
- The builder methods below follow the chain. The chain is written before the board compiles.
- A route that is one automatic leg joins the copper its net already has at its ends where that is cheapest, so the net grows as a tree; autorouter.md, Joins and loops, has the rules.
- `route(a, b, path?)` is the compatibility form, its path a string in the grammar below, omitted `XZ`: `route(J1[3], Q1[1], 'V 14 L 5 16 @B.Cu XZ')`. Never both a path and a chain.

Each end is one of:

- a pin handle, `J1[3]` or `D1.A`, or a pad handle, `J1['B4']` or `J1.pad('B4')`, see schematic.md;
- a via from `via()`, met on whichever of its layers the route arrives on, see layout.md;
- a `"REF.PIN"` string such as `"J1.3"`;
- a coordinate: `"x y"`, `"x y layer"`, `[x, y, layer?]` or `{ at, layer? }`. A string whose first token is a number is a coordinate.

The net comes from the pads at the ends, else from a via end; two pads on different nets are a compile error. A route between coordinates needs `.net(n)`, a pair `.net(P, N)`. Array ends make a differential pair. A helper types an end `RouteEnd` from `@pcbjs/core`.

Children may be any iterable, so a generator can yield vias and the routes that end at them, see layout.md, Vias.

## Path grammar

The path starts at `a` through a hidden `M`, so it never begins with `M`. Numbers are mm. The commands are those of the chain table above: `L x y`, `H x`, `V y`, `X x y` an automatic leg to the point, `@<layer>` or `@ <layer>` a via, `Z` or `z` a straight track to `b`, `XZ` or `X Z` an automatic leg to `b`. Lowercase `l`, `h`, `v` and `x` are relative.

- Every path ends at `b` with `Z` or `XZ`. Nothing may follow them.
- An omitted path is `XZ`.
- `A`, `C`, `Q`, `S`, `T` and `M` are compile errors.
- A `Z` must arrive on a layer `b` is on. Change layer with `@` first, or end with `XZ`.
- The layer after `@` takes aliases, so `@bottom` is `@B.Cu`. `U <layer>` is the old spelling of `@<layer>` and still parses.
- Coordinates in a path and coordinate ends are in the frame of the enclosing `<g>`. Pin handles are absolute.

## Builder methods

`route(a)` and `route(a, b, path)` are a node for the JSX children and a builder. Each method returns the route.

| Method | Default |
| --- | --- |
| `.width(mm)` | the net class width, else the rules' `minTrackWidth`; see Net classes |
| `.layer(name)`, the start layer | the layer of `a` when it is a pad, else `F.Cu` |
| `.layers([...])`, layers the automatic legs may use | see autorouter.md, Layers |
| `.vias(false)`, `.vias({ drill, size })` | vias allowed, the rules' default via; false forbids them in automatic legs |
| `.rules({ ... })`, any autoroute parameter | the board's |
| `.priority(n)` | 0; higher routes first |
| `.net(net)`, a pair `.net(P, N)` | inferred from the pads |
| `.lock()` | off; see autorouter.md, Cache and lock |
| `.direct()` | off; the automatic leg reaches its pads and joins no other copper of its net, see autorouter.md, Joins and loops |
| `.loop()` | off; a loop in the route's net is intended, no DRC `net-loop` for the net |
| `.impedance(ohms)` | none; sets the width from the stackup for the start layer, unless `.width()` is given |
| `.gap(mm)`, `.skew(mm)` | a pair only; see pairs.md |
| `.length(mm)`, `.length({ min, max, target, tolerance })` | none; a length target, see length.md |
| `.match(group, tolerance?)` | none; a match group, see length.md |
| `.neck({ width, length })` | the class `neck`, else on with the defaults below |
| `.corner(r)`, `.corner('none')` | the class `corner`, else square; a pair rounds by its pitch, see pairs.md |
| `.teardrops(false)`, `.teardrops({ … })` | the class `teardrops`, else the board's; see Teardrops |

Corners: `.corner(r)` rounds each corner between manual commands with an arc of radius `r` on the centre line. Where the tracks are too short, or the arc would meet other copper, it shrinks to the track width, then the corner is a 45 degree chamfer, else square. Automatic legs keep the router's corners.

Neck-down: where a route is wider than its pad's smaller side, or would come within the clearance of the pads beside it, it runs at the neck width, the pad's smaller side or `width`, never below `minTrackWidth`, until its full width clears them, at most `length` mm past the pad, default 2. `{ length: 0 }` turns it off.

## Teardrops

`<PCB teardrops={{ pads: 'tht', length: 0.5, width: 0.9 }}>`, or `teardrops` for the defaults, adds KiCad 7's straight teardrop where a track leaves a pad: from the track's edges `length` past the pad edge to a base `width` wide across the pad centre. `pads` is `'tht'`, `'smd'` or `'all'`, the default. A number is a fraction of the pad's smaller side, a string such as `'0.6mm'` a length.

- A class `teardrops: true` turns them on with the board's values, an object changes fields, `false` turns them off; `.teardrops(false)` leaves a route out.
- They are filled graphics of the net, drawn after tuning and before the pours: they join the net, other pours clear them, DRC and the Gerbers see them. A track 0.9 of the pad's side or wider gets none.
- One that would break a clearance, to copper, a hole, the edge or a keepout, shrinks to 75%, then 50%, else is left out with the info finding `teardrop-dropped`.

## Autoroute parameters

Board-wide in `<PCB autoroute={{ … }}>`, a preset, a variant target or `defineDefaultBoard`, merged key by key. A route overrides them with `.rules()` or the builder methods.

| Parameter | Default | Meaning |
| --- | --- | --- |
| `algorithm` | `'maze'` | `'maze'`, `'straight'` that avoids nothing, or a custom `RouteFn` |
| `pitch` | width / 2, 0.05 to 0.1 | grid step in mm |
| `viaCost` | 5 | one via costs this many mm of track |
| `layers` | the ends' layers, widened | copper layers the router may use, the first preferred |
| `via` | the default via | `{ drill, size }` of routed vias |
| `clearance` | 0.02 | extra mm over the rules around obstacles and the edge |
| `bend` | `'45'` | `'45'` allows diagonals, `'90'` does not |
| `prefer` | none | a direction per layer, `{ 'F.Cu': 'h', 'B.Cu': 'v' }`; moves across it cost 1.5 times |
| `maxVias` | unlimited | most vias the automatic legs of one route may place |
| `avoid` | none | soft keepouts: points kept 0.5 mm clear, or rectangles `{ x, y, w, h, layer? }`; see autorouter.md |
| `priority` | 0 | routes with a higher priority run first |
| `viaInPad` | false | per route only: a via may land in an SMD pad of the route's net |
| `ripup` | 12 | rounds of negotiation when legs do not fit in order; 0 turns it off, see autorouter.md |
| `maxDetour` | `{ ratio: 3, floor: 10 }` | a leg may run `ratio` times its straight line or the line plus `floor` mm, whichever is more; a number sets the ratio, 0 turns it off |
| `tune` | `{ amplitude: 1, spacing: 0.6, maxAmplitude: 3 }` | meander height, centre to centre, gap between its runs, edge to edge, and the height it may grow to, in mm; see length.md |

## Net classes

A class holds defaults for the routes of the nets tagged with it, `nets({ VBUS: { class: 'power' } })` or `bus(name, n, { class })`, defined in `<PCB classes>`, a preset, a variant target or `defineDefaultBoard({ classes })`, merged by class, then field.

`<PCB classes={{ power: { width: 0.5, clearance: 0.25 } }}>` gives every `power` route a 0.5 mm width and its own clearance.

| Field | Default | Meaning |
| --- | --- | --- |
| `width` | `minTrackWidth` | width of a route without `.width()` |
| `clearance` | the rules' | to other nets; the largest of the rules and both classes applies, in DRC and in the router; `{ track: 0.4 }` scopes it by kind, see rules.md Overrides |
| `impedance` | none | ohms; without `width`, the width for the start layer, to 0.01 mm, see stackup-and-rules.md |
| `via` | the default via | `{ drill, size }` |
| `layers` | see autorouter.md | copper layers the router may use |
| `autoroute` | none | autoroute parameters over the board's |
| `gap` | the width | pair gap, edge to edge, see pairs.md |
| `skew` | 0.1 | allowed length difference inside a pair, DRC `pair-skew` |
| `uncoupled` | 5 | allowed uncoupled length of a pair, DRC `pair-uncoupled` |
| `tolerance` | 0.1 | length and match tolerance, see length.md |
| `neck` | on, 2 mm | `{ width, length }`, neck-down at the pads, see Builder methods |
| `corner` | none, a pair its pitch | `{ radius }`, a length or `'none'`, the corners of the manual commands, see Builder methods |
| `teardrops` | the board's | `true` for the board's values, an object over them, `false` for none, see Teardrops |
| `loops` | false | `true` when loops in the class's nets are intended: no DRC `net-loop` |

- The route's own `.width()`, `.vias()`, `.layers()` and `.rules()` win over the class, the class over the board.
- The start layer is the route's `.layer()`, else its first pad's copper layer, F.Cu first.
- `gap`, `skew` and `uncoupled` apply to the pairs of the class, `tolerance` to `.length(mm)` and `.match()` of its routes.
- The router keeps the class clearance from other copper, so a class route draws no `clearance` finding of its own.
- A tag missing from the table is the ERC warning `net-class`; with no table at all, tags are labels.

## Differential pairs

`route([U1.pad('1'), U1.pad('3')]).V(17.2).via('B.Cu').V(18.5).via('F.Cu').X([J2[3], J2[2]]).impedance(90)` routes a pair, P first. The path is the centre line, offset into two tracks `w + g` apart, its corners rounded, with a via pair at each layer change. pairs.md has the details; examples/highspeed is a whole board.

## Length and matching

`.length()` and `.match()` set length targets and match groups, tuned with meanders before the zones fill; length.md has the rules.
