---
name: pcbjs-basics
description: Design a PCB in pcbjs, TypeScript and JSX that compiles to Gerbers. Use when starting a board with pcbjs create, editing a pcb.tsx or pcb.config.ts, connecting parts and nets, routing with route() chains, adding pours, stitching or groups, or reading the findings of pcbjs check, inspect and shot. Any project that imports @pcbjs/core qualifies.
---

# pcbjs basics

A pcbjs board is a TSX module that default-exports `<PCB>`. Nets and parts are values; the JSX places them. One compile routes, fills pours, runs DRC and ERC and, on `build`, writes the fab set and a viewer site. This skill is the working loop. For any detail, print the topic: `npx pcbjs docs <topic>`, or `npx pcbjs docs --grep <word>` to search every topic. Do not read the whole docs folder.

## The loop

1. Edit the board.
2. `npx pcbjs check`: compile, route, DRC, ERC and a type check, no files written. Exit code 1 means not orderable.
3. Need a position? `npx pcbjs inspect U1`, `inspect GND`, `inspect U1.3`. Never compute rotated pad positions by hand and never read `board.json`.
4. Need to see it? `npx pcbjs shot --select U1` writes PNGs to `.pcbjs/shots`; read them as images.
5. When check is clean, `npx pcbjs build -q` writes `.pcbjs/fab/<board>/` with `README-fab.txt` saying `STATUS: ORDERABLE`.

## A new project

```sh
npx -p @pcbjs/pcbjs pcbjs create my-board && cd my-board
npm install
npx pcbjs check
```

`create` writes `pcb.tsx`, `pcb.config.ts` with `entries: ['pcb.tsx']`, `package.json`, `tsconfig.json` with `"jsxImportSource": "@pcbjs/core"`, and a `.gitignore` that leaves out `.pcbjs/`. Every command reads its boards from `entries` in `pcb.config.ts`; entries on the command line win for that run. `pcbjs docs quickstart` has the files.

## A board

```tsx
// Hello: a green LED on a 20 x 15 mm board, powered from a two-pin header.
// Frame: mm, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route, pour, keepout } from '@pcbjs/core'
import { PinHeader, R0603, LED0603, MountingHole, roundedRect, rect, circle } from '@pcbjs/lib'

const { GND, VCC, LED } = nets()
const J1 = PinHeader(2).source({ MPN: 'PEC02SAAN' }).connect(GND, VCC)
const R1 = R0603('330').source({ MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }).connect(VCC, LED)
const D1 = LED0603('green').source({ MPN: 'LTST-C190GKT' }).connect({ A: LED, K: GND })
const Hole = MountingHole(2.2)

export default (
  <PCB name="Hello" revision="0.1.0">
    <path layer="Edge.Cuts" d={roundedRect(24, 15, 1)} />
    <J1 at="3 4.96" />
    <R1 at="9 7.5" />
    <D1 at="15 7.5 180deg" />
    <Hole ref="H1" at="20.5 3.5" />
    {route(J1[2]).Z(R1[1]).width(0.3)}
    {route(R1[2]).Z(D1.A).width(0.3)}
    {route(D1.K).X(J1[1]).width(0.3)}
    {pour(GND, 'B.Cu', rect(24, 15))}
    {keepout('all', circle(5, 20.5, 3.5))}
    <text layer="F.SilkS" at="10 12" size={1}>Hello</text>
  </PCB>
)
```

Order in a board file: a header comment with the frame, imports with the fab preset first, nets, parts one per line, then the layout: outline, placements, routes per net, pours, silk last. Move nets and parts to `<board>.sch.ts` once they outgrow a screen and pass it to the board as `import * as sch` with `<PCB schematic={sch}>`, which puts every export in scope by its bare name; part numbers go to `<board>.sourcing.ts`.

## Parts and nets

- `nets()` gives one `Net` per key read. `nets({ VBUS: { class: 'power' } })` tags a net class; `bus('D', 8)` gives D0 to D7.
- A footprint factory with a value makes a part; `.connect()` takes nets in pin order or an object keyed by pin name or pad number. It throws at the call on a wrong pin, so a bad connection fails before any layout.
- `NC` marks a pin open on purpose; any other open pin is the ERC warning `unconnected-pin`.
- A part bound to a module-level const named like a ref, `const R1 = …`, is R1. Parts made in a function or `.map` need `.ref('D3')` to keep a fixed ref.
- `U1[7]` is the pad numbered 7, never the seventh pin. `D1.A` is the pin named A. `J1['B4']` or `J1.pad('B4')` picks one pad of a pin with several.
- Declare `defineFootprint` pins inline or `as const`, or the pin names lose their types and `U1.PA9` fails to type-check.
- `pcbjs docs schematic` has handles and typing; `pcbjs docs stdlib` every footprint family.

## Routes

`route(a)` starts a chain at a pin or pad handle, a via or a coordinate. `.H(x)`, `.V(y)`, `.L(x, y)` and lowercase relative forms draw manual track; `.via('B.Cu')` changes layer; `.Z(b)` ends with a straight track, `.X(b)` with an automatic leg the autorouter lays after everything else is placed. Then `.width()`, `.layers([...])`, `.priority(n)`, `.lock()`, `.length(mm)`, `.match('GROUP')`, `.impedance(ohms)`. Array ends make a differential pair: `route([J1.DP, J1.DN]).X([U1.DP, U1.DN]).impedance(90)`.

- Lock a route you are happy with so later edits cannot move it.
- A `route-failed` finding names the nearest obstacles. Fix it cheapest first: a waypoint `.X('12 8')`, more layers, a higher `priority`, move the obstacle, or draw part of it by hand.
- Use `keepout()` for copper that must stay out; the router's `avoid` is only a cost.
- `pcbjs docs routing`, `autorouter`, `pairs` and `length` have the rest.

## Repeated blocks, pours and stitching

references/board-patterns.md has complete, compiling examples of: a channel row made by `.map` and named with `group()`, so findings say `R3 (CH3/R)`; pours on both layers with `stitch()` vias; a net class table; a length-matched group; and a board split into `pcb.sch.ts` and `pcb.tsx`.

## Reading findings

```
    error    route-failed  F.Cu  at (12.00, 7.50)  R1, D1, J1  route:2  pcb.tsx:17:6: cannot route net LED …
```

Severity, rule, layer, position in board mm, refs, route id, the source line to edit, then the message with measured and required values. Findings come grouped by rule, causes first: fix `route-failed`, `short` and `clearance` before `unconnected`, which often follows from them. `--verbose` unfolds folded lines, `--json <file>` writes every finding with a stable id. references/fixes.md lists the common rules with their usual fix; `pcbjs docs findings` lists every rule.

## Cache and cold checks

`.pcbjs/routes/<board>.json` caches every automatic leg. A warm check of an unchanged board takes every leg from it. After a large edit, judge the board by a cold check: delete `.pcbjs/routes` and run `pcbjs check` again, since one rerouted leg can move others through negotiation.

## Topics

| Need | `pcbjs docs` topic |
| --- | --- |
| install, project files, config | `quickstart` |
| `<PCB>` props, layers, stackup, defaults | `board` |
| nets, parts, handles, `defineFootprint` | `schematic`, `circuits` |
| elements, pads, vias, keepouts, text | `layout` |
| pours, reliefs, islands, `stitch()` | `pours` |
| routes, autorouter, pairs, length | `routing`, `autorouter`, `pairs`, `length` |
| rule values and overrides | `rules`, `findings` |
| presets, variants, fab set | `fab`, `fab-set` |
| commands and flags | `cli` |
| 3D and part models | `3d`, `models` |
| another board as a mechanical reference | `references` |
