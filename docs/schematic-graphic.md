# Schematic drawing

The schematic as a picture: `<Schematic>`, parts as their symbols, `<Sym>`, `<Label>`, `<Power>`, `<Sheet>`, `<Text>` and `wire()`, symbols and `defineSymbol`, the automatic placement and wiring, the `sch-*` findings and the outputs.
It is a view of the netlist in schematic.md and adds no nets; only hand wires can disagree with the board, and they are checked.

```tsx
import PCB, { Schematic, Power, Text, wire } from '@pcbjs/core'

const sheet = (
  <Schematic>
    <J1 at="4 7" />
    <Q1 at="13 10" />
    <C1 at="6 18" rot={270} />
    {wire(J1[3]).Z(Q1[1])}
    <Power net={GND} at="14 12" kind="gnd" />
    <Text at="4 26">Three LED channels switched low by Q1</Text>
  </Schematic>
)
export default <PCB name="Blinky" schematic={sheet}>{/* the layout */}</PCB>
```

## Where the drawing comes from

- Every compile draws `board.schematic.drawing`, placing and wiring what nobody placed, so a board with no schematic code has one.
- `schematic({ children: [...] })` is `<Schematic>` without JSX.
- With `<PCB schematic={sch}>`, `import * as sch from './board.sch'`, the drawing is the export `drawing`, else `default`, else the first `<Schematic>` or `schematic({ … })` export, else the compiler's. examples/demo/blinky.sch.tsx exports a hand-laid `drawing`.

## Units and page

- Positions are grid units, 2.54 mm by default, y down: `at="4 7"`; `"10.16mm"` converts at the grid. Symbols, labels and wire points snap to whole units. `board.schematic.drawing` is in mm.
- No paper by default: `drawing.page`, x0 y0 x1 y1 mm, is the box of everything grown by 3 units, no border or title block.
- `sheet="A4"` to `"A0"`: landscape paper with border and title block, the smallest allowed, growing to fit. `sheet={{ w: 200, h: 150 }}`: fixed, mm or length tokens. `drawing.paper` holds it.

## Elements

| Element | Props | Does |
| --- | --- | --- |
| `<Schematic>` | `grid`, `sheet`, `labelOver`, `labelFar`, `route`, `title` | the root; `title` goes in the title block |
| `<R1>`, any part | `at`, `rot`, `flip`, `symbol` | its symbol; `rot` 0, 90, 180 or 270 counterclockwise, `flip` mirrors left to right first |
| `<Sym>` | `part` and the same | `<Sym part={R1} at="4 6" />` |
| `<Label>` | `net`, `at`, `dir` | pins and wire ends at its point join the net by name |
| `<Power>` | `net`, `at`, `kind` | a label drawn as ground, `'gnd'`, default for GND-like names, or supply bar, `'vcc'` |
| `<Sheet>` | `group`, `name`, `at` | dashed box around a `group()` or `circuit()` instance, titled `name` or its path; children relative to `at` |
| `<Text>` | `at`, `size` | a note, `size` in mm |

- A board prop such as `side` on a symbol, or `rot`, `flip` or `symbol` on the board, is a compile error naming the part; so is one part twice.
- Unplaced symbols are placed automatically; place only those that matter.
- A function returning `<Sheet>` with `<ch.R at="2 2" />` draws one block per instance.

## Hand wires

```tsx
const drawn = [
  wire(CH1.D.K).h(2).v(14).Z(CH3.D.K),
  wire(CH2.D.K).h(2),
  wire(Q1[3]).V(3).H(35).V(7),
]
```

| Call | Does |
| --- | --- |
| `wire(from)` | starts at a pin handle or point |
| `.h(n)`, `.v(n)` | n units along x or y |
| `.H(x)`, `.V(y)` | to column x or row y |
| `.l(dx, dy)`, `.L(x, y)` | a horizontal or vertical step |
| `.Z(to)` | to a pin or point, one bend if needed; ends the wire |

A wire takes the net of the pins and labels it touches, else of wires it meets; two nets is `sch-short`. An end on a same-net wire is a tee with a junction dot.

## Automatic wiring

- Labels or power symbols at each pin for power nets, class `power` or a name such as GND, VCC, VBUS, 3V3; nets of more pins than `labelOver`, 6; nets spread further than `labelFar`, 40 units in x plus y; nets with a hand label; one-pin nets.
- Wires for the rest by the router's square mode: whole grid steps, 90 degree bends, symbols, ref and value words and other pins as walls, crossings without a dot, no overlap or touching. Nets negotiate as on the board, autorouter.md Negotiation; a net with no room gets labels. Hand wires stay and the rest join them.
- A pin on `NC` gets a no-connect cross.
- `route={false}`: hand wires and labels only; a connected pin without one is `sch-unwired`.
- Redrawn every compile in the ERC phase; no cache, no route file.

## Automatic placement

Deterministic; hand-placed symbols never move.

- A part with more than three pins, or a connector, anchors a block; small parts on its signal nets sit beside their pin, followed by chains through nets of at most three pins, such as a resistor and its LED. A part between two anchors joins the one on its more private net.
- A two-pin part on only a supply and ground is a decoupling capacitor: upright beside a symbol with a pin on that supply, in a grid above a wide one or beside a tall one.
- Unlinked small parts chain on their own. A top-level `group()` or `circuit()` instance is one block in an unnamed dashed box; `<Sheet>` names it.
- Blocks pack in reading order at the topmost, leftmost free spot, into an A-paper proportioned width, the smallest paper from `sheet` up, or a fixed `sheet`'s width; gaps grow a unit per wired net between blocks, up to eight.
- A connector with all pins one way turns them to the middle when there is room. Adjacent same-side pins on one supply share a bar and one power symbol.
- Three orders are tried, by pin count, shared nets and declaration; the smallest paper, then least wire length, bends, crossings and labels, wins.

## Symbols

Stdlib defaults: R, C, L, diodes, LEDs, transistors and FETs by pin names or SOT-23 numbering, crystals, switches, batteries, test points, numbered connectors as one pin row. Anything else, kicadFootprint parts too, is a box: supplies top, grounds and exposed pads bottom, outputs such as OUT, TX and SW right, the rest left, balanced; numbered pins only in DIP order.

```ts
const LDOSymbol = defineSymbol({
  pins: { VIN: { side: 'left', at: 1 }, EN: { side: 'left', at: 2 }, VOUT: { side: 'right', at: 1 }, GND: { side: 'bottom', at: 3 } },
})
```

| Option | Meaning |
| --- | --- |
| `pins` | `side`, `at` from the box's top or left edge, `length` 1 by default |
| `size: [w, h]` | fixed box, else fits pins and names |
| `body` | `'box'` or SVG path data in grid units from the box's top left; draws no pin names unless `names: true` |

- `defineFootprint(render, { pins, prefix, symbol: LDOSymbol })` sets it for the factory, also as a function of the props; `<R1 at="4 6" symbol={…} />` for one placement.

## Findings

ERC findings with `layer: 'sch'`, `at` in sheet mm and `items` the PCB pad ids.

| Rule | Severity | When |
| --- | --- | --- |
| `sch-short` | error | a hand wire joins pins or labels of different nets |
| `sch-missing-symbol` | warning | a symbol of a part not on the board, or symbol and part disagree on a pin |
| `sch-unwired` | warning | a connected pin with no wire or label, only with `route={false}` |
| `sch-dangling` | warning | a wire end, label or power symbol on nothing |
| `sch-overlap` | warning | two symbol bodies overlap |

An unconnected pin stays the ERC warning `unconnected-pin`.

## Outputs

- `pcbjs build` and every fab set write a light `<board>.sch.svg` beside `<board>.pcb.svg`.
- Site data carries `schematic.drawing` and `schematic.svg`, in `--sch-*` colour variables with its stylesheet.
- SVG keys: symbol `id="sch-sym-R1" data-ref="R1" data-items`, pin `data-ref data-pin data-net data-items`, wire `data-id="wire:3" data-net`, label `data-id="label:2" data-net`.
- The viewer's Schematic view cross-probes with board and editor; `pcbjs shot --view sch`, `--select R1`.
- `pcbjs inspect [entry] sch` prints page or paper, counts, symbols in grid units, wires with length and bends, labels; `--json` too.
