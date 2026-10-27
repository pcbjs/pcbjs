# Schematic drawing

The schematic as a picture: `<Schematic>`, parts as their symbols, `<Sym>`, `<Label>`, `<Power>`, `<Sheet>`, `<Text>` and `wire()`, symbols and `defineSymbol`, the automatic placement and wiring, the `sch-*` findings and the outputs.
The picture is a view of the netlist in schematic.md; it adds no nets, so it can disagree with the board only through hand wires, which are checked.

## A board always has one

Every compile draws a schematic and keeps it on the board as `board.schematic.drawing`. Without a `<Schematic>`, every part is placed and wired by the compiler, so a board with no schematic code still has a picture. To draw it yourself, pass one to `<PCB>`:

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

Inside `<Schematic>` a part element is its symbol, as inside `<PCB>` it is its footprint. `schematic({ children: [...] })` is the same without JSX. The `drawing` export of examples/demo/blinky.sch.tsx is a whole hand-laid sheet; the other demo boards are drawn by the compiler.

`schematic` also takes the schematic module as a namespace, `<PCB schematic={sch}>` with `import * as sch from './board.sch'`, see schematic.md. The drawing is then its export named `drawing`, else its `default` export, else the first export that is a `<Schematic>` or `schematic({ … })`; a module with none is drawn by the compiler. So `export const drawing = <Schematic>…</Schematic>` in the schematic module, or in a module it re-exports, is all a board needs.

## Units and page

- Positions are in grid units of the schematic's own frame, the grid 2.54 mm by default: `at="4 7"` is 4 units right and 7 down from its origin, the top left corner of the paper when there is one, y down as on the board. A token with a unit, `"10.16mm"`, is converted at the grid.
- Symbols, labels and wire points snap to whole grid units, so every pin end sits on the grid.
- The drawing in `board.schematic.drawing` is in millimetres, the grid times the units.
- By default there is no paper: the page, `drawing.page` as x0 y0 x1 y1 mm, is the box of everything drawn grown by 3 grid units, with no border, title block or paper name, and the automatic placement packs into that free canvas.
- `sheet="A4"` to `"A0"` opts into a landscape paper with its border and a title block naming the board, its revision and the paper; it is the smallest allowed, a drawing too big for it takes the next size up. `sheet={{ w: 200, h: 150 }}` is a fixed paper of that size in mm, or any length token. `drawing.paper` holds it and the page is the paper.

## Elements

| Element | Props | Does |
| --- | --- | --- |
| `<Schematic>` | `grid`, `sheet`, `labelOver`, `labelFar`, `route`, `title` | the root; `sheet` is `'A4'` to `'A0'` or `{ w, h }`, a paper with a title block, none by default; `title` goes in the title block |
| `<R1>`, any part | `at`, `rot`, `flip`, `symbol` | places the part's symbol; `rot` is 0, 90, 180 or 270 degrees counterclockwise, `flip` mirrors left to right first, `symbol` overrides the part's |
| `<Sym>` | `part` and the same | the long form, `<Sym part={R1} at="4 6" />` |
| `<Label>` | `net`, `at`, `dir` | a net label; pins and wire ends at its point join the net by name |
| `<Power>` | `net`, `at`, `kind` | a label drawn as a ground, `'gnd'`, or a supply bar, `'vcc'`; by default ground for GND-like names |
| `<Sheet>` | `group`, `name`, `at` | a dashed box around the symbols of a `group()` or `circuit()` instance, with its `name`, else the instance path; its children are placed relative to `at` |
| `<Text>` | `at`, `size` | a note, `size` in mm |

- A part element inside `<Schematic>` takes only `at`, `rot`, `flip` and `symbol`; a board prop such as `side` there, or `rot`, `flip` or `symbol` on the board, is a compile error naming the part. The types allow either set, not both.
- A part with no symbol placement is placed by the compiler, see Automatic placement, so a sheet may place only the parts that matter.
- A symbol of a part that is not on the board is the warning `sch-missing-symbol`; the same part twice is a compile error.
- Components and arrays work as on the board: a function that returns `<Sheet>` with its parts as children, `<ch.R at="2 2" />`, can draw one block per instance.

## Hand wires

`wire(from)` starts at a pin handle or a point and takes square steps in grid units:

| Call | Does |
| --- | --- |
| `.h(n)`, `.v(n)` | n units along x or y |
| `.H(x)`, `.V(y)` | to the column x or the row y |
| `.l(dx, dy)`, `.L(x, y)` | a step that must be horizontal or vertical |
| `.Z(to)` | to a pin or point, with one bend when they do not line up; nothing follows it |

```tsx
const drawn = [
  wire(CH1.D.K).h(2).v(14).Z(CH3.D.K),
  wire(CH2.D.K).h(2),
  wire(Q1[3]).V(3).H(35).V(7),
]
```

- A wire takes the net of the pins and labels it touches, at its ends or along it, else of the wires it meets. Touching two nets is the error `sch-short`.
- A wire end on the middle of another wire of its net is a tee and gets a junction dot.

## Automatic wiring

Every net is drawn with wires or with labels:

- Labels, or power symbols, at each pin for a power net, one of class `power` or with a supply or ground name such as GND, VCC, VBUS or 3V3; for a net of more pins than `labelOver`, 6 by default; for a net whose pins lie further apart than `labelFar`, 40 units across x plus y; for a net with a hand label; and for a net of one pin.
- Wires for every other net, by the router's square mode: one layer, whole grid steps, 90 degree bends only, no vias. Symbol bodies, the ref and value words and other nets' pin ends are walls, a wire leaves a pin straight out, crossing another net's wire costs a little and is drawn without a dot, running along it or meeting it at a bend, end or tee is never allowed. Nets that do not fit negotiate as the board's router does, see autorouter.md, Negotiation; a net that still finds no room gets labels instead.
- Hand wires stay as drawn; the router joins the remaining pins of the net to them.
- A pin connected to `NC` gets a no-connect cross.
- `route={false}` turns all of this off: only hand wires and labels are drawn, and each connected pin without one is the warning `sch-unwired`.

The square router keeps no cache and touches no PCB route file or its keys; the drawing is redone on every compile, in the ERC phase of the timings.

## Automatic placement

Parts without a symbol placement are clustered by connectivity, then packed around the hand-placed ones, which never move. The same board always gives the same sheet.

- A part of more than three pins, or a connector, anchors a block. A small part that shares a signal net with it sits beside the pin it meets, turned along the wire, and small parts joined to that one through nets of at most three pins follow it outward in a chain, such as a resistor and its LED. A part between two anchors joins the one on its more private net, so a coupling capacitor sits by its connector.
- A two-pin part on a supply and ground only is a decoupling capacitor: it joins a symbol with a pin on that supply, spread over the symbols by their supply pin count, and stands upright in a grid above a wide symbol or beside a tall one.
- Small parts linked to no anchor form chains of their own; parts of a top-level `group()` or `circuit()` instance stay in its block and get a dashed box without a name; only a `<Sheet>` draws one.
- Blocks, and the sheets as rectangles, are packed in reading order, each at the topmost, then leftmost, free spot: into a width that gives the free page about the proportions of A-paper, or into the smallest landscape paper from `sheet` up, or into the width of a fixed `sheet`. The gap between two blocks grows by one grid unit for every net drawn with wires between them, up to eight, to leave the router a channel. A sheet's own blocks are packed the same way, in the width that gives the most compact rectangle.
- A connector whose pins all point one way turns them toward the middle of the sheet when there is room.
- The packing is tried in three orders, by pin count, by nets shared with what is already placed, and by declaration, each wired, and the drawing on the smallest paper, if any, with the least wire length, bends, crossings and labels is kept.
- Adjacent pins of one side on one supply share a bar and one power symbol.

## Symbols

Every standard library factory has a default symbol: R, C, L, diodes, LEDs, transistors and FETs by their pin names or SOT-23 numbering, crystals, switches, batteries, test points, connectors with numbered pins as one pin row, and everything else, kicadFootprint parts included, as a generic box built from its pin list: supplies on top, grounds and exposed pads at the bottom, outputs such as OUT, TX and SW on the right, the rest on the left, balanced when one side is much longer, and a part with only numbered pins in DIP order.

`defineSymbol` draws your own in grid units: pins on the sides of a box, `at` counted from the box's top or left edge, `length` 1 by default.

```ts
const LDOSymbol = defineSymbol({
  pins: { VIN: { side: 'left', at: 1 }, EN: { side: 'left', at: 2 }, VOUT: { side: 'right', at: 1 }, GND: { side: 'bottom', at: 3 } },
})
```

- `size: [w, h]` fixes the box, else it fits the pins and their names. `body` is `'box'` or SVG path data in grid units in the box frame, origin at its top left; a custom body draws no pin names unless `names: true`.
- `defineFootprint(render, { pins, prefix, symbol: LDOSymbol })` gives every part of the factory that symbol; `symbol` may be a function of the footprint props. `<R1 at="4 6" symbol={…} />` overrides it for one placement.
- A symbol pin the part does not have, or a connected pin the symbol lacks, is the warning `sch-missing-symbol`.

## Findings

The picture's findings are ERC findings with `layer: 'sch'`, their `at` in the sheet's millimetres and `items` the PCB pad ids of the pins involved.

| Rule | Severity | When |
| --- | --- | --- |
| `sch-short` | error | a hand wire joins pins or labels of different nets |
| `sch-missing-symbol` | warning | a symbol of a part not on the board, or a symbol and its part disagree on a pin |
| `sch-unwired` | warning | a connected pin has neither a wire nor a label, only with `route={false}` |
| `sch-dangling` | warning | a wire end, label or power symbol on no pin, wire or label |
| `sch-overlap` | warning | two symbol bodies overlap |

An unconnected pin is the ERC warning `unconnected-pin` already; the picture does not repeat it.

## Outputs

- `pcbjs build` and every fab set write `<board>.sch.svg`, light, beside `<board>.pcb.svg`, see fab-set.md.
- The site data carries `schematic.drawing` and `schematic.svg`: the markup in `--sch-*` colour variables and its stylesheet, for the viewer.
- Every element of the SVG carries the board's keys: a symbol `id="sch-sym-R1" data-ref="R1" data-items`, a pin `data-ref data-pin data-net data-items` with its pad ids, a wire `data-id="wire:3" data-net`, a label `data-id="label:2" data-net`.
- The viewer shows the drawing in its Schematic view, cross-probed with the board and the editor, see viewer.md; `pcbjs shot --view sch` shoots that view, `--select R1` with R1 selected.
- `pcbjs inspect [entry] sch` prints the page size and origin or the paper, the counts, each symbol with its position in grid units, each wire with its length and bends, and each label; `--json` gives the same.
