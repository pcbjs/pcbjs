---
title: Constrain an automatic route
description: Keep a chosen waypoint and let the router solve the remaining path.
---

# Constrain an automatic route

An automatic connection is a useful starting point. When a signal needs to pass through a particular corridor, add only the geometry you need to control. This lesson compares an unconstrained route, a fixed segment and an automatic waypoint.

## Make a connection the router can solve

```tsx {13} preview=advanced-route-constraints
import PCB, { nets, route } from '@pcbjs/core'
import { PinHeader, rect } from '@pcbjs/lib'

const { SIG } = nets({ SIG: { class: 'signal' } })
const J1 = PinHeader(1)().connect({ 1: SIG })
const J2 = PinHeader(1)().connect({ 1: SIG })

export default (
  <PCB name="RoutePractice" classes={{ signal: { width: 0.3, clearance: 0.25 } }}>
    <path layer="Edge.Cuts" d={rect(32, 22)} />
    <J1 at="5 5" />
    <J2 at="26 16" />
    {route(J1[1], J2[1]).layers(['F.Cu']).vias(false)}
  </PCB>
)
```

The route takes its width and clearance from the `signal` class. The builder limits its automatic legs to front copper and forbids vias. Inspect the resulting path in `dev`, then move J2 and watch the route respond.

## Preserve one decision

Replace the route expression with `route(J1[1], J2[1]).width(0.3).V(10)`. The first segment now runs to absolute y = 10 in the current frame. Because the chain stops short of J2, an automatic leg finishes the connection.

Next try `route(J1[1], J2[1]).width(0.3).X('15 12').X()`. The router solves a path to the waypoint, then a path to J2. The waypoint fixes where the route must pass; it does not force a straight line through obstacles.

By comparison, `.Z()` finishes with a straight manual segment to the end. It draws the geometry you requested even when that geometry creates a finding. Use it when you intend to own that segment's path.

Blinky mixes fixed geometry and automatic completion. Follow a routing range to see which copper it controls:

<GuideDemo example="blinky-hybrid" />

## Read a failed route as feedback

Run `npx pcbjs check`. If a restrictive layer choice or narrow corridor prevents routing, inspect the reported leg and nearby objects before loosening constraints. Try a more useful waypoint or move a part; increasing width or clearance can reduce available room.

You can now keep a small physical decision in code without drawing every bend. Continue with [differential pairs](./differential-pairs), or use the [Routing](/docs/routing) and [Route options](/docs/route-options) references for the full chain and rule precedence.
