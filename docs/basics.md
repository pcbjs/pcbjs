# Basics

A first board end to end in nine steps, each with the one topic that has the rest: make a project, name the board, add nets and parts, place them, route, check, look at it, build the fab set, or start from KiCad instead.
Basic. This is the reading order for a first board; advanced.md indexes everything else.

## 1. Make a project

```sh
npm install -D @pcbjs/pcbjs@^0.1.0
npx pcbjs create my-board && cd my-board && npm install
```

`create` writes `pcb.tsx`, the board, and `pcb.config.ts`, which lists it in `entries`. `npx pcbjs create --list-examples` lists whole boards to start from instead, such as `blinky`, `coin` and `qfn-breakout`. Read quickstart.md.

## 2. Name the board

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'

export default (
  <PCB name="Hello" rev="0.1.0">
    <path layer="Edge.Cuts" d={roundedRect(20, 15, 1)} />
  </PCB>
)
```

The import is the fab preset: its stackup, rules and sourcing, swapped for `@pcbjs/fab/OSHPark/2-Layer` or another in fab.md. `<PCB>` takes `name` and `rev` and nothing else on a first board; the outline is a path on `Edge.Cuts`, in mm with y down. Read board.md.

## 3. Add nets and parts

```ts
const { GND, VCC, LED } = nets()
const R1 = R0603('330').connect({ 1: VCC, 2: LED })
const D1 = LED0603('green').connect({ A: LED, K: GND })
```

A net is a value, a part is a footprint factory called with its value, and `.connect()` gives each pin its net by name. The constant is the ref: `R1` on the silk, in the BOM and in every finding. Part numbers go in `.source({ MPN })`, sourcing.md; every footprint of `@pcbjs/lib` is in stdlib.md. Read schematic.md.

## 4. Place them

```tsx
<R1 at="9 7.5" />
<D1 at="15 7.5 180deg" />
<text layer="F.SilkS" at="10 12" size={1}>Hello</text>
```

A part in scope is its own element, placed by `at="x y rot"`. Text, holes, pours, vias and keepouts are elements or helpers too. Read layout.md.

## 5. Route

```tsx
{route(R1[2], D1.A).Z()}
{route(D1.K, J1[1])}
```

`route(a, b)` joins two pads: `.Z()` draws a straight track by hand, a chain such as `.H(12).V(5)` draws it your way, and nothing after the ends leaves the leg to the autorouter. Read routing.md.

## 6. Check

```sh
npx pcbjs check
```

It compiles, routes and runs DRC and ERC without writing files, and prints one line per board and one per finding, each with the source line to change. `pcbjs inspect R1` prints where a part's pads ended up. Read check.md.

## 7. Look at it

```sh
npm run dev
```

The viewer shows the board in 2D, 3D and the schematic, and a click on an item opens its code. In VS Code, `npx pcbjs ide install` puts the same viewer in a pane beside the code. Read editor.md.

## 8. Build and order

```sh
npm run build
```

Once `check` is clean, `build` writes the fab set to `.pcbjs/fab/<board>/`: Gerbers, drills, BOM, placement and one zip named with `rev`, and `README-fab.txt` says `STATUS: ORDERABLE`. Read fab-set.md.

## 9. Or start from KiCad

```sh
npx pcbjs import board my-board.kicad_pcb -o pcb.tsx
```

A KiCad board becomes a project to refine, and one footprint becomes a module with `pcbjs import footprint <Lib:Name>`. Read import.md.

## Examples

Three whole boards walk the same path, each in the repository and in `npx pcbjs create --list-examples`:

- `examples/demo/blinky.pcb.tsx`: three LED channels with the nets, parts and schematic in `blinky.sch.tsx` and the part numbers in `blinky.sourcing.ts`.
- `examples/demo/coin.pcb.tsx`: the smallest board, nets, parts and layout in one file.
- `examples/qfn-breakout/pcb.tsx`: a QFN64 broken out to four headers, every pin a bare `route(a, b)` left to the autorouter.

## Next

advanced.md indexes the rest: circuits, pours, the autorouter, pairs and length matching, rules and findings, variants, 3D models, the session and the agent tools.
