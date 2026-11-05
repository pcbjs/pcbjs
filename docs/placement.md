# Placement

Where parts go: a fixed `at`, a slot of it left `auto` for the placer, a solver or a cost of your own, and followers that sit beside routed copper; `pcbjs place --write` freezes it into the source.
Advanced. Read it to let the compiler place the parts you have no reason to place by hand.

```tsx
import PCB, { nets, route } from '@pcbjs/core'
import { C0603, PinHeader, R0603, SOT23 } from '@pcbjs/lib'

const { VIN, VOUT, GND, EN } = nets()
const J1 = PinHeader(3)().connect({ 1: VIN, 2: GND, 3: VOUT })
const U1 = SOT23(5)('LDO').connect({ 1: VIN, 2: GND, 3: EN, 4: VOUT, 5: VOUT })
const R1 = R0603('100k').connect({ 1: VIN, 2: EN })
const R2 = R0603('10k').connect({ 1: EN, 2: GND })
const C1 = C0603('1u').connect({ 1: VIN, 2: GND })
const supply = route(J1[1], U1[1]).width(0.5)

export default (
  <PCB name="Placed" rev="0.1.0" place={{ seed: 1 }}>
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={20} />
    <J1 at="3 10 90" />
    <U1 at="20 10" />
    <g name="Divider">
      <R1 at="auto" at:initial="12 4" />
      <R2 at="auto auto 90" at:cost={(layout, x, y) => (y < 10 ? null : 0)} />
    </g>
    <C1 at:follow={{ route: supply, near: U1[1], side: 'left' }} />
    {supply}
    {route(C1[1], VIN)}
    {route(C1[2], GND)}
  </PCB>
)
```

## Placement locks

`<R1 locked />` is shorthand for `<R1 locked={true} />`. Use `locked={condition}` for a boolean expression evaluated on each compile; `false` or omission leaves the placement editable. Strings such as `locked="false"` are invalid.

The toolbar reads lock state from the current placement view without requesting a full board check; changed or unavailable geometry stays pending until its view settles. Starting a lock edit still refreshes and guards the source.

A lock prevents preview movement, rotation, side changes, placement-grid changes and placement-assist writes. Selection, inspection and source navigation still work. A group containing a locked part cannot move as a whole; an unlocked sibling can still be edited individually. A mixed selection is refused rather than partially moved. The server checks locks again before writing, including when a recompilation changes the expression during a drag.

Locks belong to the placement, independently on the PCB and schematic. They do not prevent source edits or change automatic placement: use explicit `at` coordinates to fix a position across compilations. The toolbar lock button adds or removes a bare `locked` attribute. An expression, including `{true}` or `{false}`, disables the button with “Lock state is derived from an expression and cannot be overridden.” Change those values in source. Props spreads remain source-controlled. Lock changes use the same undo/redo history as other preview edits.

## Slots

`at` is `"x y rot"` in the frame of the enclosing groups. Any slot may be `auto`, and `auto` alone frees all three: `at="auto"`, `at="10mm auto 90deg"`, `at="auto auto 90"`. A slot written as a value is fixed and holds whatever chooses the others; a placement written without a rotation has it fixed at 0. A part keeps its `side`. `at:initial`, `at:cost` and `at:solver` need a slot left auto; written on a fixed placement they are a compile error.

## Precedence

| Props | The free slots come from | Runs |
| --- | --- | --- |
| `at` fixed | nothing is free | |
| `at` with an auto slot | the placer | in `place`, before placement patches |
| `at:initial="x y rot"` | where the placer's search starts, and the `initial` every solver is given; without it the search starts at the board's centre | |
| `at:cost={(layout, x, y, r) => number \| null}` | the placer, adding what it returns for each pose it tries; null forbids the pose | with the placer |
| `at:solver={(layout, part) => pose \| null}` | the solver, `{ x, y, r }`; a fixed slot wins over its pose; null hands the part to the placer, and its `at:cost` | in `place`, each solver in tree order, then the placer |
| `at:follow={{ route, near, side, distance }}` | the follower pass, beside the route's copper; it implies `at="auto"`, keeps a fixed rotation, and takes no fixed x or y, `at:cost` or `at:solver` | after `autoroute`, once |

`at:solver` wins over `at:cost` and may call it: `part.cost(x, y, r)` is the part's own `at:cost` on the same layout. `part.fixed` lists the fixed slots, null where auto, and `part.initial` the `at:initial`.

## The placer

A seeded search over every part with an auto slot at once: each step moves or turns one part, on a 0.05 mm grid and in quarter turns when the rotation is free, and keeps the step by the Metropolis rule while its temperature falls; the best layout it met wins. It minimises the sum of:

- the ratsnest half-perimeter of every net, pads of nets over 8 pads counting less, as power nets pour;
- courtyard overlap with every other part on the same side, or with any part that has through-hole pads, as boxes; a part without a courtyard counts its pads grown by 0.25 mm;
- how far a courtyard's corners lie outside the outline or inside `edgeClearance` of it;
- overlap with hard keepouts;
- for a part in a named `<g>` or a circuit instance, its distance from the centre of the group's parts, so members cluster;
- each part's `at:cost`.

The same source and seed give the same placement on every machine. `<PCB place={{ seed }}>` picks another search, default 1. The stage cache keeps the placement by its inputs: the parts as drawn, the outline and items around them, the `at` slots and the seed, and the evaluated sources too when an `at:cost` or `at:solver` is given, since those are code. An edit elsewhere places nothing, and `check --verbose` prints `placer hit` under the place stage; a design that has settled freezes it.

## Solvers and costs

`layout.part(ref)` takes a ref or the part and returns `{ x, y, r, side, box }` in board mm, null while the part has no place; `layout.outline` is the closed outline rings. A cost reads the joint state of the search as it is, never a dependency: it is called for its own part's poses, with the other parts wherever the search has them.

A solver sees the fixed parts and the parts solved before it in tree order. Reading a part the placer or the follower pass places, a later solver's part or its own is the compile error `solver-order`: `a solver reads a result made after it: R1 (pcb.tsx:12:7) → R2 (pcb.tsx:13:7)`. Every read is an edge of the dependency graph, see design.md.

`.solver(fn)` on a route is the routing twin, see autorouter.md.

## Followers

`at:follow` places a part beside the routed copper of `route`, a bound route or its id such as `'route:3'`, once routing is done: at the copper's point nearest `near`, a pin or pad handle, a part, a route point such as `supply.end` or `"x y"`, by default the route's middle; on its `side`, `'left'` or `'right'` seen from the route's start, by default the one with fewer parts and tracks of other nets in the way; turned along the track in steps of 45 degrees unless `at` fixes the rotation; its origin `distance` from the track's centre line, by default clear of the track by the rules' clearance.

- The routes that end on a follower's pads are left out of the first routing, as its pads are; they route in `routeFollowers` once it is placed, joining the copper already there, then `tune` runs over every route.
- A follower whose pad is an end of the route it follows is the compile error `follow-cycle`. A follower of a route that ends on another follower is a compile error too: the follower pass runs once and never iterates.
- A followed route that left no copper keeps the follower where it was drawn, with the warning `follow-unrouted`.
- A route solver reading a follower before it is placed is `solver-order`.

## Freezing

`pcbjs place` prints where each part with an auto slot went, `R1  at="11.3 10 0"  placer  pcb.tsx:18`. `pcbjs place --write` writes each one into its element: the auto slots of `at` take their values, a written slot keeps its text, a follower without `at` gets one, and `at:initial`, `at:cost`, `at:solver` and `at:follow` go. The board compiled from the frozen source is the same board. An element whose `at` is no string literal, or one a loop places several parts with, is left alone and named, with the `at` to write by hand.

In an editor, the code action **Freeze the auto placement of this file** on the line of such a part makes the same edits through the editor, so unsaved text is kept; it is offered by the language server, in VS Code and Neovim alike.

## Order

`place` positions parts after the design is flattened: solvers in tree order, then the placer, then placement patches, see patches.md; references resolve after that. The follower pass sits between `autoroute` and `tune`, see design.md.
