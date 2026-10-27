# Autorouter

How `route()` becomes copper: the layers and vias the router picks, the order, negotiation, detours, joins and loops, failures, keepouts, the route cache and locks, routing with variants, and the other forms of a track.
The router is a grid A* maze router that runs after everything else on the board exists. routing.md has the route call and its parameters.

## Layers

Without `layers`, a leg first tries the layers of its two ends. When that fails, it tries again with the board's outer layers added, unless `maxVias` is 0. So on a two-layer board an SMD to SMD leg on F.Cu may drop to B.Cu with two vias. Set `.layers([...])` to pin the layers; then there is no second try.

### Vias

The router places a via only where:

- it clears copper of other nets on every layer it spans, inner layers included;
- its hole keeps `minHoleToHole` from every other hole, of any net, its own route's vias included;
- it is outside every SMD pad of its own net, unless the route sets `viaInPad`;
- it is outside every keepout that forbids vias.

### Order

Routing waits until the whole tree is flattened and the outline is known. First the manual parts of every route are placed, in document order. Then the automatic legs run route by route, by `priority`, then in declaration order. Each routed track and via is an obstacle for the routes after it, and a pair stands as laid out, fans and via pairs included, from the moment its centre line is complete, see pairs.md. Zones fill after routing, so pours are not obstacles.

A leg of higher priority is never displaced by one of lower priority. Automatic legs of lower priority already on the board, from the cache or a negotiation, do not stop it: it routes through them and they route again after it.

### Negotiation

When a leg finds no path, negotiated congestion routing takes over, the PathFinder scheme, so the order rarely matters:

- The legs that failed route again over a shared occupancy of the board: the copper of every other automatic leg is passable, at a price per cell it shares with a leg of another net. Pads, manual tracks, drawn tracks, vias placed by hand, keepouts, whole-net tracks, locked routes with a stored result and routes with `ripup: 0` stay hard.
- A cell is shared when the centre of a track there would come closer to the other leg than the clearance, grown as the obstacles are, so two legs that share no cell keep the clearance. Via holes keep `minHoleToHole` from the legs of their own net too.
- After each round, every leg that shares copper with a leg of another net routes again in the next round, in priority and declaration order, and from the second round on so do the legs close to such a spot, which may have to make room. The price of sharing grows each round, and the cells a leg shared stay dearer for good, the history cost, so the legs spread out, take a via or go round.
- Priority holds in negotiation: a leg pays the price on the cells of legs of its own priority or higher and does not see legs of lower priority at all, so it keeps its path and they move. Of two colliding legs only the one of lower priority routes again, both when they have the same.
- Negotiation ends when no two legs of different nets touch, or after `ripup` rounds, 12 by default. Then the leg of lowest priority with the most collisions leaves the board, until nothing collides, and each of those tries once more around everything; one that still finds no path is a `route-failed` error naming the route it collided with.
- The pass is deterministic. `board.routing.rounds` and `board.routing.ripped` count the rounds and the legs taken off; the routing line of `pcbjs check` prints both.
- When every leg routes in order, nothing of this runs.

`priority` decides who goes first and who keeps the short path when two routes compete, so give long control lines a lower priority than the pairs they cross. `ripup: 0` turns negotiation off and gives back the plain order; on one route it keeps that route's legs where the order puts them, and no route of higher priority moves them.

### Detours

`maxDetour` bounds how long a leg may get, as a ratio of the straight line between its ends and a floor in mm: a leg may run `ratio` times the line or the line plus `floor`, whichever is more, 3 and 10 mm by default. Vias do not count. The search stops at the bound, so a leg that would wander round the board fails instead, `no path found within maxDetour, at most 78.3 mm for 26.1 mm between its ends`, and negotiation can move what is in its way. `maxDetour: 2` sets the ratio, `{ ratio, floor }` both, and `maxDetour: 0` turns the bound off.

## Joins and loops

A lone automatic leg, `route(a).X(b)` or `route(a, b)`, joins its net's copper: its search starts anywhere on the copper joined to its start pad and ends at the first touch of the copper joined to its end pad. A leg to a pad that has a track meets that track where it is cheapest, so the net grows as a tree, a Y where two legs from one pad would cross. Pads and vias are met at their centres, tracks anywhere.

- Copper of the net joined to neither end is an obstacle for every automatic leg, so no leg crosses its own net and closes a loop. A pad that nothing joins yet is not, and a leg that crosses it joins it.
- A leg whose ends the net already joins places nothing.
- The joining legs of one net and priority route widest first, then longest, so thin legs join trunks that carry the width.
- A leg that joins a thinner trunk lays the trunk again at its width, from its pad to the junction, as tracks of its route. When that breaks a clearance the leg runs to its pad instead, or joins and leaves the trunk thin when nothing reaches the pad, with the info finding `trunk-narrow`. A future `current` on routes and classes would size a shared trunk from its branches.
- `.direct()` keeps a leg off every other copper of its net: it reaches its pads itself, for Kelvin sense lines and star returns.
- Chains with waypoints, manual commands or vias, pairs, and routes with `.length()` or `.match()` never join.
- In negotiation a leg that routes again looks at the copper again, and a leg whose join moves routes again.
- When the router's own legs still close a loop, the costliest joining leg whose removal keeps the net's pads joined comes off. A loop left over is the DRC warning `net-loop`, see findings.md.

## Failures

A leg that cannot be routed does not stop the compile. Every other leg still routes, DRC and ERC still run, and the leg becomes a DRC error `route-failed`:

```
error    route-failed  F.Cu  at (12.00, 7.50)  R1, D1, J1  pcb.tsx:16:6: cannot route net LED from (9.825, 7.5) on F.Cu to (14.175, 7.5) on F.Cu, layers F.Cu, B.Cu: no path found; nearest obstacles: pad R1.1 (VCC), pad D1.1 (GND), track (VCC) (pcb.tsx:15:27), pad J1.2 (VCC), pad J1.1 (GND)
```

- The source is the route call, `at` the midpoint of the leg, the layers those tried; `leg 2 of 3 of` appears when the route has several automatic legs.
- A track keepout that cuts the straight line between the ends on every layer tried comes first with its source, `blocked by the keepout (pcb.tsx:12:5) on F.Cu, B.Cu`: it is the likely cause, not the pads nearby.
- The nearest obstacles are up to five items of other nets nearest the straight line between the ends, with their sources. The net also shows as `unconnected`.
- A leg that negotiation could not fit names the route it collides with: `no path found that keeps clear of the route of net B (pcb.tsx:21:6); negotiation stopped after 12 rounds, the ripup bound`.
- A pair whose centre line routes but whose two tracks cannot be laid out counts its legs as failed, not routed.

`<PCB strict>` turns the first failed leg into a compile error, for CI. A failure is reported only after negotiation, so the routes really do not fit. Fixes, cheapest first: give a route a waypoint with `X x y`, allow more layers, raise `ripup` or `maxDetour`, move the obstacle, or draw part of it by hand.

A waypoint is a point the route passes, not a pad: an automatic leg may end on it only where the centre of the track keeps the clearance from other copper, else the leg fails with `the end at (x, y) is inside the clearance of other copper`. Only an end on copper of the route's own net, a pad most often, may sit closer.

## Keepouts and avoid

- `<keepout>` or `keepout()` is hard. The router never enters it, pours are cut by it, DRC flags copper inside it. See layout.md.
- `avoid` is soft. The router crosses it when there is no other way, and nothing checks it afterwards.

Use keepouts for anything that must hold: antenna areas, mounting screws, test pads.

## Cache and lock

Every automatic leg is cached by its request, priority included, and a hash of the final copper around its result, its own route left out, the laid out pairs in. The next compile places every stored leg and lays out the pairs whose legs are all stored, then checks each leg against its hash and against the stored legs before it with negotiation's test: a stored leg that collides routes again, so a route file never brings back copper that touches. An unchanged board takes every leg from the cache and gives the same items as the cold compile that wrote the file. A leg whose surroundings or priority changed routes again, and so do the legs around it, by priority.

A joining leg stores only its new copper, from the junction on, and its hash takes in its net's copper routed before it, so an edit to the trunk routes it again.

A cold compile, a fresh clone without `.pcbjs/` among them, routes everything in priority order and may differ from a warm one after many edits, whose legs were each routed when their surroundings last changed. For copper that must not move, lock the route or commit the route file.

- The cache lives in memory for the life of the process, so dev server recompiles reuse it.
- On disk it is `.pcbjs/routes/<board>.json` under the project root. `pcbjs build`, `check`, `inspect` and `dev` read and write it. `compileBoards` called from your own code uses it when the working directory has a `pcb.config` file.
- One leg or lock per line, so a diff shows which routes changed. Only entries the last compile used are kept.
- A leg that failed is stored as failed and not tried again until something on the board or its `ripup` changes.
- A custom `RouteFn` is never cached. Each length tuning step is cached in the same file, keyed on the route's untuned copper and aim and checked against the copper, courtyards and silk around it, see length.md.
- Delete the file to reroute everything.

`.lock()` pins a route's automatic legs to their stored result: a locked route with none routes and negotiates like any other, and its lock then holds what it got, even when obstacles around it change, until the net, the ends or the path change. A locked route that now crosses new copper shows as a DRC finding instead of moving. `.pcbjs/` is in the template's `.gitignore`, so a fresh checkout routes locked routes again on its first compile.

## Variants

With `variants(...)`, targets that have the same copper count and the same autoroute parameters are routed once, under the strictest rules of the group: the largest clearance, track width, edge and hole clearances, via sizes and hole-to-hole. Every target in the group gets the same copper and the same `route-failed` findings. `board.routing.shared` names the targets and the rules used.

A target with `routeSeparately: true` is routed on its own, under its own rules, and its copper may differ. Its legs are cached under its slug in the same route file.

## Other forms

- `<track>` with `d` an SVG path draws track by hand, one track per subpath; with `d` a `RouteFn` or omitted it connects every item of its `net`.
- `route(net, { width, d, layer?, layers?, via?, from?, to?, algorithm?, auto?, points? })` is the legacy object form: `d` draws a path, `from` and `to` route one connection.
- A custom `RouteFn` gets a `RouteRequest` and a `RouteContext` and returns `{ tracks, vias }`; throwing fails the leg with the message. `routers.maze` and `routers.straight` are the built-ins.
