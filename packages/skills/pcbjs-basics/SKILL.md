---
name: pcbjs-basics
description: Design a PCB in pcbjs, TypeScript and JSX that compiles to Gerbers. Use when starting a board with pcbjs create, editing a pcb.tsx or pcb.config.ts, connecting parts and nets, routing with route() chains, adding pours, stitching or groups, or reading the findings of pcbjs check, inspect and shot. Any project that imports @pcbjs/core qualifies.
---

# pcbjs basics

A pcbjs board is a TSX module that default-exports `<PCB>`. Nets and parts are values; the JSX places them. One compile routes, fills pours, runs DRC and ERC and, on `build`, writes the fab set and a viewer site. This skill is the working loop; the detail is in the docs, the `docs` tool or `npx pcbjs docs <topic>`, and `--grep <word>` searches every topic. Do not read the whole docs folder.

## Tools first

When the pcbjs MCP tools are present, use them: they talk to the session that already compiled the board, see the editor's unsaved text, and need no shell. Without them, the CLI does the same, each command in brackets below.

- Before your first edit, call `session` with your task and a plan of up to five lines; update `progress` as you go. The human sees it at once and can redirect you before you spend anything.
- A message from the human arrives at the top of a tool result, or of your turn through the hook; act on it first. It names entities as references such as `R1`, `CH2/R01/2`, `net:VCC` or a finding id: `query` or `render` them.
- Change source with `write`, edits anchored on text you just read, or your harness's edit tool. Never overwrite an existing file with a whole-file Write: it loses the editor's unsaved text and every concurrent change.
- Pair mode, one agent in the human's tree, is the default. Work in a git worktree only when the human asked for parallel work.

## The loop

1. Edit the board.
2. `check` [`npx pcbjs check`]: compile, route, DRC, ERC and a type check, no files written. Exit code 1 means not orderable.
3. Need a position or a detail? `inspect` with `U1`, `GND`, `U1/3` [`npx pcbjs inspect U1`], `query` for one record [`npx pcbjs q R1`]. Never compute rotated pad positions by hand and never read `board.json`.
4. Need to see it? `render` with `frame` and `highlight` [`npx pcbjs shot --select U1`, PNGs in `.pcbjs/shots`].
5. What changed since you looked: `events` [`npx pcbjs events --since <next>`].
6. When check is clean, `npx pcbjs build -q` writes `.pcbjs/fab/<board>/` with `README-fab.txt` saying `STATUS: ORDERABLE`.

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
const J1 = PinHeader(2)().source({ MPN: 'PEC02SAAN' }).connect({ 1: GND, 2: VCC })
const R1 = R0603('330').source({ MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }).connect({ 1: VCC, 2: LED })
const D1 = LED0603('green').source({ MPN: 'LTST-C190GKT' }).connect({ A: LED, K: GND })
const H1 = MountingHole(2.2)()

export default (
  <PCB name="Hello" rev="0.1.0">
    <path layer="Edge.Cuts" d={roundedRect(24, 15, 1)} />
    <J1 at="3 4.96" />
    <R1 at="9 7.5" />
    <D1 at="15 7.5 180deg" />
    <H1 at="20.5 3.5" />
    {route(J1[2], R1[1]).width(0.3).Z()}
    {route(R1[2], D1.A).width(0.3).Z()}
    {route(D1.K, J1[1]).width(0.3)}
    {pour(GND, 'B.Cu', rect(24, 15))}
    {keepout(circle(5, 20.5, 3.5))}
    <text layer="F.SilkS" at="10 12" size={1}>Hello</text>
  </PCB>
)
```

Order in a board file: a header comment with the frame, imports with the fab preset first, nets, parts one per line, then the layout: outline, placements, routes per net, pours, silk last. Move nets and parts to `<board>.sch.ts` once they outgrow a screen and pass it to the board as `import * as sch` with `<PCB schematic={sch}>`, which puts every export in scope by its bare name; part numbers go to `<board>.sourcing.ts`.

## Parts and nets

- `.connect({ … })` takes the nets by pin name and throws at the call on a wrong pin, so a bad connection fails before any layout. `NC` marks a pin open on purpose.
- The constant a part is bound to is its ref, `const R1 = …` is R1; nothing is numbered. A part made in `.map` takes its `ref` from the loop data.
- `U1[7]` is the pad numbered 7, never the seventh pin; `D1.A` is the pin named A.
- Declare `defineFootprint` pins inline or `as const`, or `U1.PA9` fails to type-check.
- Topics `schematic`, `footprints` and `stdlib` have the rest.

## Routes

`route(a, b)` with no chain is left to the autorouter; a chain such as `.H(12).V(5)` draws it your way and `.Z()` finishes it straight. Topic `routing` has the chain, `route-options`, `autorouter`, `pairs` and `length` the rest.

- A `route-failed` finding names the nearest obstacles. Fix it cheapest first: a waypoint `.X('12 8')`, more layers, a higher `priority`, move the obstacle, or draw part of it by hand.
- Use `keepout()` for copper that must stay out; the router's `avoid` is only a cost.

## Repeated blocks, pours and stitching

references/board-patterns.md has complete, compiling examples of: a channel row made by `.map`, refs from the loop data and each block in a `<g name>`, so findings say `R3 (CH3/R3)`; pours on both layers with `stitch()` vias; a net class table; a length-matched group; and a board split into `pcb.sch.ts` and `pcb.tsx`.

## Reading findings

```
    error    route-failed  F.Cu  at (12.00, 7.50)  R1, D1, J1  route:2  pcb.tsx:17:6: cannot route net LED …
```

Severity, rule, layer, position in board mm, refs, route id, the source line to edit, then the message with measured and required values. Findings come grouped by rule, causes first: fix `route-failed`, `short` and `clearance` before `unconnected`, which often follows from them. `--verbose` unfolds folded lines, `--json <file>` writes every finding with a stable id. references/fixes.md lists the common rules with their usual fix; `pcbjs docs findings` lists every rule.

## Cache and cold checks

`.pcbjs/cache` keeps every stage's output and, in `route/<board>.json`, every automatic leg. A warm check of an unchanged board reads its result without compiling, and an edit reroutes only the legs it touches. After a large edit, judge the board by a cold check, `pcbjs check --fresh=all`, since one rerouted leg can move others through negotiation.

## Intent kept as tests

When asked to keep a property of the design, such as a capacitor near its pin, a part on one side or a net clean, write it as a board test, never only a comment: a `*.test.ts` beside the board that reads `board()` of `@pcbjs/cli/test` and asserts with the board API. `npx pcbjs test` runs every one, `npx pcbjs check --test` after the checks, so the next edit that breaks it fails. `npx pcbjs test --update` writes goldens of the fab set, which then fail on any change to the copper.

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { board } from '@pcbjs/cli/test'

test('C1 within 2 mm of U1 pin 4', () => {
  assert.ok(board().distance('C1', 'U1/4').d <= 2)
})
```

`script` [`npx pcbjs script <code>`] runs the same API once, for a question no query answers.

## Report a missing detail

When a finding made you compute something it should have said, such as a distance, a pad position or the item in the way, say which detail you computed in your answer: that message is a bug to fix in pcbjs.

## Topics

`docs` with no arguments [`npx pcbjs docs`] lists every topic with its summary; start with `basics`, and `advanced` lists the rest by need. `check` reads the check output, `findings` lists every rule, `mcp` the tools.
