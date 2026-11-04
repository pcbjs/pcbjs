---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/cli': patch
---

`route(a, b, …)` takes any number of ends: the first is the root and every other end is an automatic leg that joins the growing tree where it is cheapest. `route(NET)` routes every pad of a net as one tree from its first pad, or from the pad `.root(end)` names, and `route(end, NET)` joins the end to the nearest copper of the net. A chain runs from the first end toward the second: `.L(x, y)` or `.L(p)` draws a straight track, `.X(p)` an automatic leg to a waypoint, `.A(x, y, angle)` and `.a(dx, dy, angle)` an arc turning counter-clockwise on screen for a positive angle, `.Z()` finishes straight and `.X()` automatically at the end, and a chain that stops short finishes with an automatic leg. `.branch(b => b(end).V(2).Z())` forks at the chain's current point, each branch with its own end, width and vias. `.width()` applies from where it is called, before any command the route's width. Copper drawn by hand is a chain from a coordinate, `route('3 10').net(VCC).H(9)`, and a chain from a pad that ends nowhere is a compile error. `.rules()` takes the autoroute parameters that have no method of their own, `maxDetour` is an object `{ ratio, floor }`, a net class `corner` is a radius or `'none'`, and the route cache keys the legs of a route with a chain, branches or more than two ends on all of it.
