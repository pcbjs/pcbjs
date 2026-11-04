# Autorouter

How `route()` becomes copper: the layers and vias the router picks, the order, negotiation, detours, joins and loops, failures, keepouts, the route cache and holds, routing with variants, and custom routers.
Advanced. The router is a grid A* maze router that runs after everything else on the board exists. routing.md has the route call, route-options.md its parameters.

```tsx
import PCB from '@pcbjs/core'
import { keepout, route } from '@pcbjs/core'

export default (
  <PCB name="Router" rev="0.1.0" autoroute={{ ripup: 12, maxDetour: { ratio: 3, floor: 10 }, avoid: [{ x: 10, y: 5, w: 4, h: 2 }] }}>
    {keepout('M 20 0 h 5 v 5 h -5 Z')}
    {route(U1[1], J1[1]).priority(2).layers(['F.Cu', 'B.Cu'])}
    {route(U1[2], J1[2]).rules({ ripup: 0, maxDetour: { ratio: 2 }, viaInPad: true })}
    {route(U1[3], R1[1]).direct()}
  </PCB>
)
```

## Layers and vias

Without `layers`, a leg tries its ends' layers, then adds the outer layers unless `maxVias` is 0. `.layers([...])` pins them, with no second try.

A routed via clears other nets' copper on every layer it spans, keeps `minHoleToHole` from every hole, its own route's included, stays out of its own net's SMD pads unless `viaInPad`, and out of keepouts that forbid vias.

## Order

Three ways a router can meet the parts of a board: route each leg as it is declared, never moving it for what comes later; route once everything exists, in order, each leg final; or route once everything exists and negotiate. pcbjs offers the last two. Negotiation after everything exists is the default; `ripup: 0`, on the board or on a route, is the second, legs kept where the order puts them. Routing at declaration is never offered: a route written before the parts it would pass would fix copper the rest of the board must bend around.

Manual parts of every route are placed first, in document order, once the outline is known. Then automatic legs run by `priority`, then declaration order, each an obstacle for the next; a pair stands as laid out, fans and via pairs included, once its centre line is complete. Zones fill after routing, so pours are not obstacles.

A higher priority leg is never displaced by a lower one: it routes through lower legs already placed and they reroute after it.

## Negotiation

When a leg finds no path, PathFinder negotiated congestion routing takes over.

- Failed legs reroute with other automatic legs passable at a price per shared cell. Pads, manual and drawn tracks, hand vias, keepouts, held routes and `ripup: 0` routes stay hard.
- A cell is shared when a track centre there comes within the clearance of the other leg. Via holes keep `minHoleToHole` from legs of their own net too.
- Each round, legs sharing copper with another net reroute, from round two also legs near such a spot. The price grows per round and shared cells keep a history cost.
- A leg pays on cells of its own priority or higher and ignores lower legs; of two colliding legs the lower reroutes, both when equal.
- After `ripup` rounds, 12 by default, the lowest priority leg with most collisions leaves the board until nothing collides; each tries once more, else `route-failed` naming the route it hit.
- Deterministic. `board.routing.rounds` and `board.routing.ripped` count rounds and legs taken off; `pcbjs check` prints both.

Give long control lines a lower `priority` than the pairs they cross. `ripup: 0` turns negotiation off; on one route it keeps its legs where the order puts them.

## Detours

| `maxDetour` | Bound on a leg's length, vias not counted |
| --- | --- |
| default `{ ratio: 3, floor: 10 }` | `ratio` times the straight line or line plus `floor` mm, whichever is more |
| `{ ratio: 2 }` | twice the straight line, or the line plus 10 mm |
| `{ ratio: 0 }` | no bound |

Past the bound a leg fails, `no path found within maxDetour, at most 78.3 mm for 26.1 mm between its ends`.

## Joins and loops

A lone automatic leg, `route(a, b)`, runs from any copper joined to its start pad to the first touch of copper joined to its end pad, so a net grows as a tree. Pads and vias are met at their centres, tracks anywhere.

- Each extra end of `route(a, b, c, …)` is such a leg toward the root `a`; `route(NET)` is one from every other pad of the net toward its root.
- A route ending on a net, `route(R2[1], VCC).V(-2)`, finishes with a leg that joins the copper of the net nearest its last point. A branch leaves from its fork and joins only at its end.

- Net copper joined to neither end is an obstacle, so no leg closes a loop; an unjoined pad is not, and is joined when crossed.
- A leg whose ends are already joined places nothing. One net's joining legs route widest first, then longest.
- A leg joining a thinner trunk relays it at its width to the junction; if that breaks a clearance it runs to its pad, or leaves the trunk thin with the info `trunk-narrow`. A future `current` would size shared trunks.
- `.direct()` keeps a leg off the rest of its net, for Kelvin sense and star returns.
- Chains with waypoints, manual commands or vias, pairs, and `.length()` or `.match()` routes never join, except a route ending on a net.
- A loop the router's legs close drops the costliest removable joining leg; one left over is the warning `net-loop`, see findings.md.

## Failures

A failed leg does not stop the compile; it is a DRC error `route-failed` and its net `unconnected`.

```
error    route-failed  F.Cu  at (12.00, 7.50)  R1, D1, J1  pcb.tsx:16:6: cannot route net LED from (9.825, 7.5) on F.Cu to (14.175, 7.5) on F.Cu, layers F.Cu, B.Cu: no path found; nearest obstacles: pad R1/1 (VCC), pad D1/1 (GND), track (VCC) (pcb.tsx:15:27), pad J1/2 (VCC), pad J1/1 (GND)
```

| Part | Meaning |
| --- | --- |
| source | the route call; `leg 2 of 3 of` with several automatic legs |
| `at`, layers | the leg's midpoint, the layers tried |
| `blocked by the keepout (pcb.tsx:12:5) on F.Cu, B.Cu` | a track keepout cuts the straight line on every layer tried |
| nearest obstacles | up to five items of other nets nearest the straight line |
| `no path found that keeps clear of the route of net B (pcb.tsx:21:6); negotiation stopped after 12 rounds, the ripup bound` | negotiation could not fit it |

- A pair whose centre line routes but whose tracks cannot be laid out counts as failed.
- `<PCB strict>` makes the first failed leg a compile error, for CI.
- Fixes, cheapest first: an `.X(p)` waypoint, more layers, raise `ripup` or `maxDetour`, move the obstacle, draw part by hand.
- A leg may end on a waypoint only where the track keeps the clearance, else `the end at (x, y) is inside the clearance of other copper`.

## Keepouts and avoid

| | Router | Pours | DRC |
| --- | --- | --- | --- |
| `keepout()`, see layout.md | never enters | cut | flags copper inside |
| `avoid` | a cost, crossed when needed | no effect | not checked |

## Cache and holds

Each automatic leg is cached by its request, priority included, and a hash of the copper around it, laid out pairs in. A leg of a route with a chain, branches or more than two ends is keyed on the whole route as written too, so two routes that differ in a branch share no leg. A warm compile places stored legs, and a leg that collides or whose surroundings or priority changed reroutes, with the legs around it. A joining leg stores only its copper from the junction, its hash including its net's earlier copper.

- In memory for the process, and on disk in `.pcbjs/cache/route/<board>.json`, read and written by `pcbjs build`, `check`, `inspect`, `dev` and the session; `compileBoards` writes it only when given `cache: { dir }`. These are the leg and tune memos of the `autoroute` and `tune` stages: a stage hit skips the router, a miss takes every leg whose obstacle hash still matches. Their keys start with `ROUTER_VERSION` and `TUNE_VERSION`, so another compiler version keeps routing warm while every stage output misses; see design.md.
- One leg or tune step per line; only entries the last compile used stay. Delete the file, or run `check --fresh=all`, to reroute everything.
- A failed leg stays failed until the board or its `ripup` changes.
- A custom `RouteFn` is never cached. Length tuning steps share the file, see length.md.
- A cold compile may differ from a warm one after many edits.

`pcbjs patch hold route:3` freezes a route: it writes the copper of its automatic legs into the `.patches.ts` file beside the entry, tracked source, and the router places that copper first, an obstacle to every other leg, until the route's request, ends, net, width or layers change; tuning runs over it as over any leg. A held route crossing new copper is a DRC finding, not a move. patches.md has the rest.

## Variants

With `variants(...)`, targets with the same copper count, autoroute parameters and auto placements route once under the strictest rules of the group: largest clearance, track width, edge and hole clearances, via sizes and hole-to-hole. They share copper and `route-failed` findings; `board.routing.shared` names the targets and rules. `routeSeparately: true` routes a target alone under its own rules, cached under its slug.

## Custom routers

`.solver(fn)` on one route asks `fn(request, ctx)` for each of its automatic legs before the router runs: `request` is the leg's `RouteRequest` and `ctx` a `RouteContext` with `ctx.part(ref)`, a part's origin, rotation and side, and `ctx.route(r)`, the copper of a route whose solver ran before, as `{ tracks, vias }`. It returns `{ tracks, vias }`, placed as a held leg is, an obstacle that negotiation never moves, or null to leave the leg to the router. Solvers run in the order the router takes legs, so reading a route routed after it, its own route or a follower not placed yet is the compile error `solver-order`. `board.routing.solved` counts the legs solvers laid out; their copper is never memoised, and a route without a solver keeps its request and leg key as before.

A custom `RouteFn` as `algorithm` takes a `RouteRequest` and a `RouteContext` and returns `{ tracks, vias }`; a throw fails the leg. A built-in is named by its string, `'maze'` or `'straight'`; to wrap one in your own `RouteFn` call `routers.maze`, `routers.straight`.
