---
title: Match route lengths
description: Add a match group, reserve tuning space and inspect the measured result.
---

# Match route lengths

Routes with different geometric paths can need a common length window. In this lesson you will add a match group to two routes, inspect their measured lengths, and learn why tuning needs physical room.

## Give the routes a common target group

```tsx {13,14} preview=advanced-length-matching
import PCB, { nets, route } from '@pcbjs/core'
import { PinHeader, rect } from '@pcbjs/lib'

const { D0, D1 } = nets()
const J1 = PinHeader(2)().connect({ 1: D0, 2: D1 })
const J2 = PinHeader(2)().connect({ 1: D0, 2: D1 })

export default (
  <PCB name="LengthPractice">
    <path layer="Edge.Cuts" d={rect(40, 28)} />
    <J1 at="5 5" />
    <J2 at="32 19 90" />
    {route(J1[1], J2[1]).width(0.25).match('DATA', 0.2)}
    {route(J1[2], J2[2]).width(0.25).match('DATA', 0.2)}
  </PCB>
)
```

The two automatic paths need not start with equal lengths. The match group uses its longest member as the reference and tunes shorter members toward the allowed window. It does not shorten a route that is already too long.

## Measure before changing the tuner

Run:

```sh
npx pcbjs check
npx pcbjs inspect --lengths
```

Read each route's measured length, match group, target and tuning status. Measurements follow track arcs and include via travel through the board. A differential pair contributes its longer track to a match group.

If the exercise reports a `length-match` finding, read its reason before changing the tolerance. A segment can be too short for a useful bump, or nearby copper, courtyards and silk can leave no legal tuning room. Move a component or choose a longer clear corridor and compare the new result.

## Reserve space for tuning

A route can override tuning preferences with `.rules({ tune: { amplitude: 2 } })`. Amplitude describes room beside the original run; it does not authorize the tuner to cross other objects. Keep both the new copper and its clearances visible when judging the result.

For one route with an absolute requirement, use `.length({ target: 34, tolerance: 0.2 })` instead of a match group. A target asks for that length; a match group asks members to agree with one another. Choose the requirement that matches the circuit's timing budget.

You can now distinguish a requested target from a measured and successfully tuned route. The [Length and matching reference](/docs/length) explains tuning order and limits; [highspeed](/examples/highspeed) shows a larger matched data bus.
