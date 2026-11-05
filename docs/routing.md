# Routing

`route(a, b, …)` and its chain: ends, the chain commands, branches, drawn copper, width and layer, pairs in short.
Basic. route-options.md has the builder methods, teardrops, autoroute parameters and net classes; autorouter.md how copper is placed, failures, keepouts, cache, holds and variants; pairs.md the pairs in full; length.md length targets and matching.

```tsx
{route(J1[3], Q1[1]).width(0.25)}                                                  // autorouted all the way
{route(J1[2], R1[1]).width(0.3).Z()}                                               // one straight manual track
{route(J1[3], Q1[1]).width(0.25).V(14).L(5, 16).via('B.Cu').H(24).V(7.5).via('F.Cu')} // manual, two vias, autorouted last hop
{route(J1[2], R1[1], R2[1], R3[1]).width(0.3)}                                     // a tree: each end joins where cheapest
{route(GND)}                                                                       // every pad of the net
```

## Ends

`route(a, b, …)`: the first end is the root; the chain runs from it toward the second end; every further end is an automatic leg that joins the growing tree where cheapest, in the order the router picks.

| End | Example |
| --- | --- |
| pin or pad handle | `J1[3]`, `D1.A`, `J1['B4']` |
| via from `via()`, met on the arriving layer | layout.md Vias |
| coordinate, first token a number | `"x y"`, `"x y layer"`, `[x, y, layer?]`, `{ at, layer? }` |
| an open point after a pad, a stub | `route(J1[2], '5 5').Z()` |
| a net, as the last end | `route(R2[1], VCC)` joins any copper of VCC |
| a point of another route | `vccTrunk.end`, `vccTrunk.start`, `vccTrunk.pt(2)`, `ch2.vccTrunk.end`, see Route points |
| pair | array ends, `route([aP, aN], [bP, bN])` |

- `route(NET)` routes every pad of the net as one tree from its first pad in document order, or from `.root(end)`.
- The net comes from the pads, else a via end; pads on two nets are a compile error, coordinates alone need `.net(n)`. Type a helper's end as `RouteEnd` from `@pcbjs/core`.
- Coordinates in ends and in the chain are in the enclosing `<g>` frame; pin handles are absolute.

## The chain

| Call | Does |
| --- | --- |
| `.L(x, y)`, `.l(dx, dy)` | manual track to the point |
| `.L(p)` | manual track to a waypoint, `'5 16'`, `[5, 16]` or a via |
| `.H(x)`, `.h(dx)`, `.V(y)`, `.v(dy)` | manual track along x or y |
| `.A(x, y, angle)`, `.a(dx, dy, angle)` | manual arc to the point, turning through `angle`, degrees or `'1.2rad'`, counter-clockwise on screen when positive |
| `.via(layer, { drill, size })` | via at the cursor, continue on `layer`; `drill` and `size` set this via, default the route's `.vias()`, class, board `autoroute.via`, board `via`, then legacy fallback |
| `.cross(layer)` | pairs only, a crossover, pairs.md |
| `.X(p)` | automatic leg to a waypoint |
| `.width(w)` | the track width from here on |
| `.Z()` | straight manual track to the end, which finishes the chain |
| `.X()` | automatic leg to the end, which finishes the chain |

- Lengths are mm or unit strings, `'10mil'`. A waypoint is on the current layer, never a pin.
- A chain that stops short of its end finishes with an automatic leg, so `route(a, b).V(14)` and `route(a, b).V(14).X()` are one route. Nothing follows `.Z()` or `.X()`.
- `.Z()` must arrive on a layer of the end: `.via()` first, or `.X()`.
- `.width()` before any command is the route's width; after one it holds from there on, so a neck or a wide trunk is written where it starts.
- A lone automatic leg, `route(a, b)` with no chain, joins its net's copper where cheapest, growing a tree, autorouter.md Joins and loops.
- A chain from a pad that ends in the open is a compile error: give its end, or end it in `.branch()`.
- A stub from a pad to an open point starts at the pad and declares the point as its end, `route(J1[2], '5 5').Z()`; one pad as both ends is a compile error naming it.

## Branches

```tsx
{route(J1[2], R3[1]).width(0.4).H(9).branch(b => b(R2[1]).width(0.25).V(2).Z()).V(5).Z()}
```

| Case | Spelling |
| --- | --- |
| a branch from a point of the chain | `.branch(b => b(end)…)` |
| a branch whose fork the router chooses | an extra end, `route(J1[2], R3[1], R1[1])` |
| a manual tail joining the net anywhere | its own route ending on the net, `route(R2[1], VCC).V(-2)` |

- `.branch()` forks at the cursor and takes sub-chains only; each `b(end)` declares its end and is anchored at the fork. The trunk continues after the call.
- A sub-chain takes the chain commands, `.width()`, `.current()` and `.branch()`; it starts at the fork's width and finishes like a route, with `.Z()`, `.X()` or an automatic leg.
- A route with branches, extra ends or a net as its end takes no `.length()`, `.match()` or `.impedance()`.

## Drawn copper

```tsx
{route('3 10').net(VCC).width(0.3).H(9).A(12, 13, 90).V(20)}
{route('3 25 B.Cu').net(null).width(1).H(30)}
```

- A chain from a coordinate with no other end is copper drawn by hand, for copper with no pad at either end; `.net(n)` gives its net, `.net(null)` puts it on no net, layout.md No net. Copper on no net takes no automatic leg.
- One call per stroke; a via in the chain joins strokes on two layers.

## Route points

A route bound to a name has points: `.start` is `pt:0`, `.pt(k)` where its k-th chain call ends, `.end` where its last one ends or its end when the chain runs to it. Each is a route end and an `at:follow` near, placement.md, on the layer the route is on there.

```ts
import { circuit, route, type Ports } from '@pcbjs/core'
import { R0603 } from '@pcbjs/lib'

export const chan = circuit('chan', ({ VCC, LED }: Ports<'VCC' | 'LED'>) => {
  const R01 = R0603('330').connect({ 1: VCC, 2: LED })
  const vccTrunk = route('9 0').net(VCC).width(0.3).H(11.175)
  return { R01, vccTrunk }
})
```

- A route a circuit build binds and returns is a member of each instance, `ch2.vccTrunk`, typed like `ch2.R01`; its layout places it, `{g.vccTrunk}`, and a member route no layout places is a compile error. `{route(J1[2], ch2.vccTrunk.end)}` routes to the end of that instance's trunk.
- The reference grammar names it `CH2/route:vccTrunk`, its points `CH2/route:vccTrunk/pt:2`, refs.md; `pcbjs inspect` and `pcbjs q` answer them.
- A route ending on a point waits for the route it names, whatever their order in the tree; two routes that end on each other's points are a compile error.

## Width and layer

```tsx
{route(J1[2], R1[1]).width(0.3)}
{route(U1[4], J2[1]).layer('B.Cu')}
```

- `.width(mm)` sets the track width, else the net class width, else `minTrackWidth` of the rules.
- `.current('2A')`, or `'500mA'` or amps as a number, on a route or a branch states what it carries; DRC `current-width` checks every width it declares against the IPC-2152 baseline for the thinnest copper its tracks run on, at a 10 °C rise: about 0.29 mm for 1 A and 1.1 mm for 2 A on 1 oz. Currents sum toward the root: a stretch of trunk carries its own current, or the sum of the branches that fork after it when that is more, so a trunk is never thinner than its branches need. An extra end shares the route's current. Automatic pad neck-downs are not included in this check; inspect their widths separately, since `.current()` is not a thermal validation of all resulting copper.
- `.topology()` is reserved for bus topologies such as fly-by and star and throws until they arrive.
- A route starts on its first pad's copper layer, else `F.Cu`; `.layer()` picks another, and the router chooses the layers of automatic legs, autorouter.md.
- Every other method, the autoroute parameters, teardrops and net classes are in route-options.md.

## Differential pairs

```tsx
{route([U1[1], U1[3]], [J2[3], J2[2]]).impedance(90).V(17.2).via('B.Cu').V(18.5).via('F.Cu')}
```

P first; the chain is the centre line, offset into tracks `w + g` apart, a via pair per layer change; no branches or arcs; pairs.md, examples/highspeed.

Via dimensions resolve field by field: legacy rule-grown fallback, board `via`, board `autoroute.via`, class `autoroute.via`, class `via`, route `.vias()`, then chain `.via()` dimensions. Standalone `via()`, stitching and via patches use board `via` followed by their call dimensions; class and `autoroute` settings retain their route-only scope. Pair search envelopes grow to fit both holes, while physical pair vias retain the resolved fabrication dimensions. Explicit dimensions never grow silently to satisfy minima.
