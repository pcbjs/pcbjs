---
title: Route the connections
description: Compare manual, automatic and hybrid routing on the same Blinky board.
---

# Route the connections

The schematic says which pins share a net. Routes put copper between those pins. Blinky combines copper drawn by hand with automatic legs, so you can control the important geometry without specifying every corner.

## Manual routing

Find the VCC bus in `pcb.tsx`. `route('3 10').net(VCC).width(0.3).H(9)` draws a horizontal 0.3 mm track from `(3, 10)` to x = 9. Because both ends are geometric coordinates, `.net(VCC)` identifies the copper's net.

The next stroke at x = 9 runs vertically from y = 5 to y = 15, feeding the three channel rows. `.H()` and `.V()` take absolute coordinates. Their lowercase forms, `.h()` and `.v()`, take relative distances. `.L()` draws a straight segment to an x/y point.

For a route between two pads, `.Z()` draws the final straight segment to the destination. It does not search around obstacles, so you must leave a legal path.

<GuideDemo example="blinky-manual" />

## Automatic routing

A route between two pad handles can leave its entire path to the router. The following is an alternative to Blinky's existing SIG route, not an additional route to paste beside it:

<GuideDemo example="blinky-automatic" />

The pads supply the net. With no manual chain, the compiler chooses the path using the board's layers, obstacles and rules. In JSX, place the route expression inside braces, as the existing calls in `pcb.tsx` do.

## Hybrid routing

Blinky uses a manual chain for that same SIG connection. It travels to y = 14, then `(5, 16)`, changes to `B.Cu`, continues across the back, and returns to `F.Cu`. The chain stops short of Q1, so the compiler automatically finishes the last leg. The `.X('24 16')` in the middle requests an automatic leg to that point; the remaining `.V()` and layer change constrain the approach before the automatic final connection.

This division gives the route a deliberate corridor while leaving its final approach to the router. `.via('B.Cu')` changes layers at the current point; the following segments use that layer until another change.

<GuideDemo example="blinky-hybrid" />

## Copper can also be an area

Blinky calls `pour(GND, 'B.Cu', rect(W, H))` to fill the back with ground copper. A route brings Q1's ground pad toward that layer. The compiler clears the pour from other nets and checks whether the ground connection is complete.

**Try it:** follow SIG from J1 pin 3 to Q1 pin 1 in 2D, switching copper layers at its vias. Then inspect the route's endpoints:

```sh
npx pcbjs inspect J1/3
npx pcbjs inspect Q1/1
npx pcbjs check
```

Next: [Check the result](./checks). The [Routing reference](/docs/routing) lists the chain commands; [Autorouter](/docs/autorouter) explains route failures and the routing controls.
