# pcbjs

pcbjs is PCB design as TypeScript and JSX. A board is a TSX module that default-exports `<PCB>`. Nets and parts are values in a schematic, and the layout places the parts as JSX elements. The compiler flattens the tree into absolute items in millimetres, routes the tracks you leave to it, fills pours, computes connectivity and runs DRC and ERC. It writes Gerber X2, Excellon drills, a job file, a BOM, a placement file and one `.pcb.svg` document, all zipped, plus a static site with a 2D and 3D viewer that links every item back to its code. This is a proof of concept.

## Quick start

Node 22.12 or newer; docs/quickstart.md has the project files, the config and the edit loop. `@beta` is the npm tag until 0.1; `latest` holds a placeholder with no code.

```sh
npm install -D @pcbjs/pcbjs@beta
npx pcbjs create my-board && cd my-board && npm install
npx pcbjs check              # compile, route, DRC and ERC of the entries in pcb.config.ts
npm run dev                  # live viewer on http://localhost:5173
npm run build                # fab set in .pcbjs/fab/my-board, site in .pcbjs/dist
```

From source, for contributors: clone https://github.com/pcbjs/pcbjs, run `npm install && npm run build` at its root, and read docs/development.md.

## Example

`examples/demo/blinky.pcb.tsx`, the layout of the Blinky demo board. Its nets and parts come from `blinky.sch.tsx`, whose exports `schematic={sch}` puts in scope by name, and each LED channel is a `circuit()` placed by its row layout.

```tsx
import PCB, { route, pour, via } from '@pcbjs/core'
import { Brand, rect, roundedRect } from '@pcbjs/lib'
import * as sch from './blinky.sch'
import './blinky.sourcing'
import { LedChannelRow } from './lib/led-channel.layout'

const W = 30,
  H = 20

export default (
  <PCB
    name="Blinky"
    revision="0.1.0"
    copper={2}
    schematic={sch}
    rules={{ clearance: 0.2, minTrackWidth: 0.2, strictNets: true, requireSourcing: true }}
    autoroute={{ bend: '45', viaCost: 4 }}
  >
    <path layer="Edge.Cuts" d={roundedRect(W, H, 2)} />

    {/* J1, Q1 and C1 by hand, each channel by its circuit's row layout */}
    <J1 at="3 7.46" />
    <Q1 at="26 10" />
    <LedChannelRow g={CH1} at="0 5" label="LED1" />
    <LedChannelRow g={CH2} at="0 10" label="LED2" />
    <LedChannelRow g={CH3} at="0 15" label="LED3" />
    <C1 at="15 10" side="B" />
    <text layer="B.SilkS" at="15 8.3" size={0.8}>
      C1
    </text>

    {/* tracks as path strings, a via, and a chain whose last hop .X() leaves to the autorouter */}
    {route(VCC, { width: 0.3, d: 'M 3 10 H 9 M 9 5 V 15 M 9 11.6 H 15.8' })}
    {via(VCC, '15.8 11.6')}
    {route(VCC, { layer: 'B.Cu', width: 0.3, d: 'M 15.8 11.6 V 10' })}
    {route(SW, { width: 0.3, d: 'M 22.2 5 V 16.5 H 27 V 10' })}
    {route(J1[3]).V(14).L(5, 16).via('B.Cu').H(24).V(7.5).via('F.Cu').X(Q1[1]).width(0.25)}

    {/* GND: a pour over the back, Q1.2 autorouted into it */}
    {route(Q1[2]).X('25 12.5 B.Cu').width(0.3)}
    {pour(GND, 'B.Cu', rect(W, H))}

    <text layer="F.SilkS" at="3 4.3" size={0.8}>
      GND
    </text>
    <text layer="F.SilkS" at="15 18.5" size={1}>
      Blinky · pcbjs
    </text>
    <Brand at="15 4" height={5} layer="B.SilkS" />
  </PCB>
)
```

## For agents

Read this section, then `pcbjs docs <topic>` for the one topic you need, or the same page under https://pcbjs.dev/docs/. Do not read the whole docs folder.

### Mental model

- Schematic: `nets()` gives `Net` values; a footprint factory with a value gives a `Part`; `.connect(...)` binds pins to nets and throws at the call when a pin is wrong.
- Parts are values: put them in arrays and objects, make them in `.map` and plain functions, and name a group of them with `group('P1', { J, SW })` so findings say `U8 (P3/SW)`.
- Layout: a part is placed as a JSX element, `<R1 at="9 7.5" />`. A part bound to a variable named like a ref, `const R1 = …`, is R1; other parts are numbered by declaration order.
- Routes: `route(a)` and a chain from a pin handle, `.H(x)`, `.via('B.Cu')`, ending at `.Z(b)` for a straight track or `.X(b)` for an automatic leg, which the autorouter lays after everything else is placed. `route(a, b, path)` with a path string is the same route.
- Build: one compile gives the board model, DRC, ERC, the fab set and the site. `pcbjs check` is the build without files; its findings carry position, refs and the source line to change, and `pcbjs inspect` prints where parts, pads and nets ended up, in absolute mm.

### Commands

```sh
pcbjs check                             # the loop: the entries in pcb.config.ts; compile, route, DRC, ERC; exit 1 on errors
pcbjs check --json .pcbjs/r.json        # every finding with a stable id, for scripts
pcbjs check --watch                     # recompile on save, print new and fixed findings
pcbjs inspect                           # every footprint: ref, path, value, at, rot, side, source
pcbjs inspect U1                        # one part's pads: number, name, net, centre, size, layers
pcbjs inspect GND                       # one net: pads, vias, track widths, failed routes; also REF.PAD
pcbjs inspect U1 GND --lengths DATA     # several answers from one compile; route lengths of a net, pair or group
pcbjs inspect coin.pcb.tsx U1           # with several entries, name the board's entry first
pcbjs build -q                          # fab set and site, summary lines only
pcbjs dev -p 0                          # live viewer on a free port, URL in the first lines
pcbjs dev --workspace .                 # one server for every project below, each loaded on first use
pcbjs shot --select U1 --select J1      # PNGs framed on each part, in .pcbjs/shots; --layer repeats too
pcbjs docs routing                      # one topic; pcbjs docs lists them
pcbjs docs --grep 'neck|escape'         # every doc line that matches, a word or a regex
```

### Reading `pcbjs check`

A board whose LED route is walled off by a keepout:

```
Probe  pcb.tsx  3 footprints, 6 pads, 1 track, 0 vias, 0 zones, 3 nets  DRC 3 errors, 0 warnings, 2 unconnected  ERC ok  FAIL  254 ms: route 45 ms, zones 1 ms, connectivity 1 ms, drc 4 ms, erc 8 ms
  routing 1 leg, 0 routed, 1 failed, 0 cached, 0 locked, 0 ripped, 0 rounds
  DRC route-failed: 1 error
    error    route-failed  F.Cu  at (12.00, 7.50)  R1, D1, J1  route:2  pcb.tsx:17:6: cannot route net LED from (9.825, 7.5) on F.Cu to (14.175, 7.5) on F.Cu, layers F.Cu, B.Cu: no path within maxDetour: every way is longer than 14.35 mm, for 4.35 mm between its ends; blocked by the keepout (pcb.tsx:15:6) on F.Cu, B.Cu; nearest obstacles: pad R1.1 (VCC), pad D1.1 (GND), track (VCC) (pcb.tsx:16:27), pad J1.2 (VCC), pad J1.1 (GND)
  DRC unconnected: 2 errors
    error    unconnected  at (9.41, 6.23)  J1, D1  pcb.tsx:13:5: net GND is not fully connected, from J1.1 at (3.00, 4.96) to D1.1 at (15.83, 7.50)
    error    unconnected  LED: net LED is not fully connected: route route:2 failed, see route-failed
FAIL  DRC 3 errors, 0 warnings, 2 unconnected  ERC 0 errors, 0 warnings
```

The first line is one board: name, entry, counts, DRC and ERC totals, `FAIL` when not orderable, compile time and phase times. The routing line counts the autorouter legs: routed, failed, reused from the cache, kept by locks, then the legs negotiation took off the board and its rounds. Then the findings, grouped by rule, causes first: `route-failed`, `short`, `clearance`, the rest, `unconnected` last. A net whose route failed folds into one `unconnected` line that points at it; `--verbose` prints every finding unfolded. The last line is the total over every board; exit code 0 means every board is orderable. Take the route-failed line field by field:

| Field | Here | Meaning |
| --- | --- | --- |
| severity | `error` | `error` blocks ordering, `warning` does not |
| rule | `route-failed` | the DRC rule; ERC rules print as `ERC <rule>`; `pcbjs docs --grep <rule>` explains it |
| layer | `F.Cu` | when the finding has one |
| position | `at (12.00, 7.50)` | board mm, x right, y down |
| refs | `R1, D1, J1` | parts involved; inside a circuit `R4 (CH2/R)` |
| route | `route:2` | the route it concerns, as `pcbjs inspect --lengths` lists it |
| source | `pcb.tsx:17:6` | the line to edit: the route call, the part placement or the item; a route made in a helper reads `pcb.tsx:40:5 via lib/fan.tsx:12:5`, the call site first |
| message | after `: ` | measured and required values, or for routes the ends, layers tried, a keepout that walls the leg off and the nearest obstacles |

### Where files land

| Path | What |
| --- | --- |
| `.pcbjs/fab/<board>/` | Gerbers, drills, `bom.csv`, `cpl.csv`, `<board>.pcb.svg`, `README-fab.txt`, the zip |
| `.pcbjs/dist/` | the static site; `boards/<board>.json` is the full model, large |
| `.pcbjs/routes/<board>.json` | cached and locked routes |
| `.pcbjs/dev.json` | port, pid and route of a running dev server |
| `STALE` in a fab dir | the last compile of that entry failed; the files are old |

### Rules of thumb

- Run `pcbjs check`, not `build`, while iterating, `--json <file>` when a script needs the findings, and `pcbjs inspect` for coordinates. Never read `board.json` or compute rotated pad positions by hand.
- Declare `defineFootprint` pins inline or `as const`, or pin names lose their types.
- Every pad must match a pin by name or number, or be marked `nc`: `<pad nc />` or the footprint's `nc` list.
- A pin with several pads routes to the pad nearest the other end. Use the pad handle `J1['B4']` to choose, `J1.pad('B4')` when the pad id is also a pin key.
- Use `keepout()` for areas copper must avoid. The router's `avoid` is only a cost.
- A `route-failed` finding names the nearest obstacles. Raise the route's `priority`, add an `X x y` waypoint, or allow more layers. Call `.lock()` on routes you are happy with, so later edits cannot move them.
- With `variants()`, targets share one routing under the strictest rules; `routeSeparately: true` opts one out.
- Route a differential pair with array ends, `route([J1.DP, J1.DN]).X([U1.DP, U1.DN]).impedance(90)`; the path is its centre line.
- `.length(mm)` tunes a route to a target and `.match('DATA')` tunes a group to its longest; `pcbjs inspect <entry> --lengths` shows the result.
- A KiCad footprint is `kicadFootprint('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm')` in code or `pcbjs import footprint <Lib:Name>` as a file to edit; a KiCad board starts as `pcbjs import board <file.kicad_pcb>`, then `pcbjs check --fab`.
- When a part is not in the stdlib, take its STEP model from KiCad's library, `pcbjs model add <url> --ref J1 --write`, or from LCSC's EasyEDA library, `pcbjs model add --ref J1 --write` for a part with an `MPN:LCSC` number; `pcbjs model check` flags misplaced models.

### Topics

| Topic | What it covers |
| --- | --- |
| `quickstart` | install, project files, config, the loop |
| `board` | `<PCB>` props, units, coordinates, layers, stackup, defaults |
| `schematic` | nets, parts, connect, pin and pad handles, `nc`, `defineFootprint`, typing |
| `circuits` | circuits, ports, instance names, layouts |
| `schematic-graphic` | the schematic drawing: `<Schematic>`, symbols, wires, labels, automatic wiring, `sch-*` findings |
| `sourcing` | `MPN` keys, `source()`, sourcing tags, BOM resolution |
| `layout` | elements, pads, `pour`, `via`, `keepout`, shapes, text |
| `pours` | pour fill, thermal reliefs, islands, `stitch()` stitching vias |
| `routing` | route ends, path grammar, builder methods, teardrops, parameters, net classes |
| `autorouter` | layers, vias, order and rip up, failures, keepouts, cache and lock, variants |
| `pairs`, `length` | differential pairs: array ends, centre line, gap, impedance, via pairs, pair DRC; length targets, match groups and meanders |
| `rules` | rule values, overrides per pad, part and net, fab rule sets |
| `findings` | every DRC and ERC rule with its severity, and what makes a board orderable |
| `fab`, `fab-set` | presets, `bindPCB`, variants; every file of the fab set, README-fab, BOM, the Gerber self check |
| `cli`, `inspect` | every command and flag, output formats, JSON report, exit codes; every `pcbjs inspect` query and its output |
| `viewer` | the 2D viewer, panels, multi-board sites |
| `editor`, `highlight` | source links, repository links, VS Code extension, IDE mode, drafts; source ranges and the token under the cursor |
| `3d`, `models` | the 3D view and part models; `pcbjs model add`, align and check, where to find model files and their licences |
| `references` | another entry's board as a mechanical reference: mate, stack, its two DRC rules, caching, cycles |
| `skills` | the agent skills of `@pcbjs/skills`: `pcbjs skills install`, what each skill covers, writing one |
| `stdlib` | every footprint family with pins and frame, footprint helpers |
| `kicad`, `import` | coming from KiCad: frame, back side, refs, text, Gerber differences; `pcbjs import footprint` and `board`, `kicadFootprint()`, the refine steps |
| `workspace`, `stackup-and-rules`, `fonts`, `ide-bridge`, `design`, `development` | the workspace dev server, background, the editor protocol, rationale, repository layout and limits |

Each is `docs/<topic>.md` here, `pcbjs docs <topic>` anywhere and https://pcbjs.dev/docs/ on the web.
