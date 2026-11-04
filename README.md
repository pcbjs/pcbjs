# pcbjs

PCB design as TypeScript and JSX. A board is a TSX module: nets and parts are values, JSX places them, and one compile routes what you leave to the autorouter, fills pours, runs DRC and ERC, and writes Gerbers, drills, a BOM and placement file, all zipped, plus a 2D, 3D and schematic viewer that links every item back to its code. This documentation targets pcbjs 0.1.0.

```sh
npm install -D @pcbjs/pcbjs@^0.1.0    # Node 22.12 or newer
```

## Quick start

```sh
npx pcbjs create my-board && cd my-board && npm install
npx pcbjs check              # compile, route, DRC and ERC; one line per finding with the source line to change
npm run dev                  # live viewer on http://localhost:5173
npm run build                # fab set in .pcbjs/fab/my-board, site in .pcbjs/dist
```

`pcbjs create` writes this first board, `pcb.tsx`: a green LED and its resistor on a 20 x 15 mm two-layer board.

```tsx
// Hello: a green LED on a 20 x 15 mm two-layer board, powered from a two-pin header.
// Frame: millimetres, origin at the top-left corner of the outline, x right, y down.
import PCB from '@pcbjs/fab/JLCPCB/2-Layer' // the fab: stackup, rules and LCSC sourcing; swap for another preset such as @pcbjs/fab/OSHPark/2-Layer
import { nets, route } from '@pcbjs/core'
import { PinHeader, R0603, LED0603, roundedRect } from '@pcbjs/lib'

// Nets: one name per net.
const { GND, VCC, LED } = nets()

// Parts: the value, the part numbers, then the net of each pin by name. MPN is the catch-all, MPN:LCSC is what JLCPCB assembles.
const J1 = PinHeader(2)().source({ MPN: 'PEC02SAAN' }).connect({ 1: GND, 2: VCC })
const R1 = R0603('330').source({ MPN: 'RC0603FR-07330RL', 'MPN:LCSC': 'C23138' }).connect({ 1: VCC, 2: LED })
const D1 = LED0603('green').source({ MPN: 'LTST-C190GKT' }).connect({ A: LED, K: GND })

export default (
  <PCB name="Hello" rev="0.1.0">
    {/* outline: 20 x 15 mm with 1 mm corners */}
    <path layer="Edge.Cuts" d={roundedRect(20, 15, 1)} />

    {/* power in: pin 1 GND, pin 2 VCC */}
    <J1 at="3 4.96" />

    {/* the LED and its resistor, in line with J1 pin 2; D1 turned so its anode faces R1 */}
    <R1 at="9 7.5" />
    <D1 at="15 7.5 180deg" />

    {/* routes: .Z() draws a straight track by hand, a route with no chain is left to the autorouter */}
    {route(J1[2], R1[1]).width(0.3).Z()}
    {route(R1[2], D1.A).width(0.3).Z()}
    {route(D1.K, J1[1]).width(0.3)}

    {/* silk */}
    <text layer="F.SilkS" at="10 12" size={1}>
      Hello
    </text>
  </PCB>
)
```

More boards to start from: `npx pcbjs create --list-examples`, and `examples/demo` with Blinky, a board split into schematic, sourcing and layout files. From source, for contributors: clone https://github.com/pcbjs/pcbjs, run `npm install && npm run build`, and read docs/development.md.

## For agents

Read this section, then `pcbjs docs <topic>` for the one topic you need, which is `docs/<topic>.md` here and the same page under https://pcbjs.dev/docs/. Do not read the whole docs folder; `pcbjs docs --grep 'neck|escape'` prints every doc line that matches a word or a regex. `pcbjs skills install` adds the agent skills of `@pcbjs/skills` to the project and registers `pcbjs mcp`, whose tools a harness then prefers to the shell. `pcbjs docs check` reads the check output field by field; `pcbjs docs findings` lists every rule.

### Mental model

- Schematic: `nets()` gives `Net` values; a footprint factory with a value gives a `Part`; `.connect({ … })` binds pins to nets by name and throws at the call when a pin is wrong. Parts are values: make them in `.map` and plain functions, a loop part with `{ ref }`; the constant a part is bound to is its ref, `const R1 = …` is R1, and nothing is numbered.
- Layout: a part is placed as a JSX element, `<R1 at="9 7.5" />`, or `<Place part={LEDS[2]} at="…" />`; `<g name="P3">` makes `U8` also `P3/U8`.
- Routes: `route(a, b)` and a chain from `a`, `.H(x)`, `.via('B.Cu')`, finishing at `b` with `.Z()` for a straight track or, by default, an automatic leg the autorouter lays after everything else. More ends make a tree; `route('3 10').net(VCC).H(9)` is copper without pads.
- Build: one compile gives the board model, DRC, ERC, the fab set and the site. Findings carry position, refs and the source line to change; `pcbjs inspect` prints where parts, pads and nets ended up, in absolute mm.

### Commands

```sh
pcbjs check                         # the loop: compile, route, DRC, ERC of the entries in pcb.config.ts; exit 1 on errors
pcbjs check --json .pcbjs/r.json    # every finding with its id and fingerprint, for scripts
pcbjs inspect U1 GND                # a part's pads, a net's copper; with several entries name the entry first
pcbjs inspect --lengths DATA        # route lengths of a net, pair or match group
pcbjs shot --select U1              # PNGs of the viewer framed on a part, in .pcbjs/shots
pcbjs dev -p 0                      # the session on a free port; Ctrl-C detaches, pcbjs session stop ends it
```

### Rules of thumb

- Iterate with `pcbjs check`, not `build`; ask `pcbjs inspect` for coordinates, never read `board.json` or rotate pads by hand. Declare `defineFootprint` pins inline or `as const`, or pin names lose their types; every pad matches a pin by name or number, or is marked `nc`.
- `keepout()` keeps copper out; the router's `avoid` is only a cost. A `route-failed` finding names the nearest obstacles: add an `X x y` waypoint, raise `priority`, allow more layers, or move a part. `pcbjs patch hold route:<n>` freezes a route you are happy with.
- A pin with several pads routes to the pad nearest the other end, the pad handle `J1['B4']` chooses; pairs are array ends, `route([J1.DP, J1.DN], [U1.DP, U1.DN]).impedance(90)`, and `.length(mm)` and `.match('DATA')` tune lengths.
- KiCad: `kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm')` in code, `pcbjs import footprint` or `pcbjs import board` as files to edit; STEP models by `pcbjs model add`.

## Docs

### Basics

| Topic | What it covers |
| --- | --- |
| `basics` | a first board end to end, in order, one step per topic below |
| `quickstart` | install, project files, config, the loop |
| `board` | `<PCB>` with `name` and `rev`, units, coordinates, layers |
| `schematic` | nets, parts, names, `.connect`, placing, pin and pad handles |
| `layout` | elements, pads, `pour`, `via`, `keepout`, shapes, text |
| `routing` | route ends, the chain, branches, drawn copper, width and layer |
| `check` | the edit loop, reading `pcbjs check`, exit codes, where files land |
| `editor` | source links, the VS Code extension, panes, hovers and lenses |
| `fab-set` | every file of the fab set, README-fab, BOM and placement |
| `import` | `pcbjs import footprint` and `board`, `kicadFootprint()` |

### Advanced

| Topic | What it covers |
| --- | --- |
| `advanced` | every topic below, grouped |
| `circuits` | circuits, ports, instance indices and refs, layouts |
| `footprints` | `defineFootprint`, `part()`, `withPins`, typing pin and pad names |
| `schematic-graphic` | the schematic drawing, symbols, wires, automatic wiring |
| `sourcing` | `MPN` keys, `.source()`, sourcing tags, BOM resolution |
| `stdlib` | every footprint family with pins and frame, footprint helpers |
| `placement` | `auto` slots, the placer, solvers, costs, followers, freezing |
| `grids` | `defineGrid`, grid units, origins on pads and points, schematic grids, snapping |
| `stackup` | the stackup, its builders, project-wide defaults |
| `fonts` | stroke and outline fonts for `<text>` and their licences |
| `pours` | pour fill, thermal reliefs, islands, `stitch()` |
| `route-options` | builder methods, teardrops, autoroute parameters, net classes |
| `autorouter` | layers, vias, order and rip up, failures, cache and holds |
| `pairs` | differential pairs, gap, impedance, via pairs, pair DRC |
| `length` | length targets, match groups and meanders |
| `patches` | edits by reference, holds, the `.patches.ts` file |
| `rules` | rule values, overrides per pad, part and net, fab rule sets |
| `findings` | every DRC and ERC rule, finding ids, what makes a board orderable |
| `refs` | the reference grammar every surface names things with |
| `testing` | board tests and golden fab sets |
| `fab` | fab presets, `bindPCB`, `variants` |
| `references` | another board as a mechanical reference |
| `3d` | the 3D view, generated part models, the model cache |
| `models` | `pcbjs model add`, align and check, model licences |
| `cli` | every command and flag, the `--json` report |
| `inspect` | every `pcbjs inspect` query and its output |
| `interaction` | UI operations, source boundaries, cancellation and acceptance |
| `viewer` | the 2D and schematic views, panels, multi-board sites |
| `layout-editing` | instance overrides, shared library layouts, source ownership and undo |
| `editing` | the viewer's tools: move, rotate, side and control points, what a drag writes, the assist mode |
| `keys` | every key and gesture of the views, the modifier contract, the command palette |
| `ui` | `@pcbjs/ui`, the views and panels as Vue components, and the `?pcb:` imports for a site of your own |
| `render` | the render spec behind `pcbjs shot` and `session/render`, views, cameras, framing, highlight, marks, the budget |
| `diff` | `pcbjs diff <ref>`, before, after and tinted diff images against a git commit, the pull request comment |
| `vscode` | the extension in depth: attaching, sidebar, commands, settings, drafts |
| `editor-actions` | editor operation ownership, cancellation, undo and availability |
| `highlight` | what the cursor and hover pick, source ranges |
| `session` | the one process `pcbjs dev`, the editor and agents share |
| `workspace` | one session for several projects |
| `queries` | `pcbjs events`, `q`, `script` and the board API |
| `skills` | the agent skills and `pcbjs skills install` |
| `mcp` | `pcbjs mcp`, the MCP server that gives agents the checks, queries, renders and edits as tools |
| `lsp` | `pcbjs lsp --stdio`, the language server for Neovim, Helix, Zed, JetBrains and Claude Code |
| `plugins` | compiler plugins: stages, hooks, checks |
| `browser` | the compiler in a Web Worker, what of it runs in a browser, its equality with Node |
| `library` | `pcbjs build --lib`, a project as a package of parts, circuits and boards, `compose()` |
| `kicad` | what carries over from KiCad and what does not |
| `stackup-and-rules` | the sources behind every stackup and rule value |
| `ide-bridge` | the protocol between the session and an editor |
| `design` | why pcbjs is built the way it is |
| `development` | working on pcbjs itself: packages, build, tests |
| `support` | what is supported, partial and missing, with the evidence for each |
