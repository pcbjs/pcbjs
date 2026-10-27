# Layout

The elements a board is drawn with, the `pour`, `via` and `keepout` helpers, the shape helpers, hard keepouts and text.
Routes are in routing.md, parts and their placement props in schematic.md, and pours, thermal reliefs, islands and `stitch()` in pours.md.

## Elements

Lengths are numbers in mm or strings with a unit. Defaults are written as `prop = value`.

| Element | Required | Optional, with defaults | Notes |
| --- | --- | --- | --- |
| `<g>` | none | `at` = "0 0 0", `side` | a group; transforms its children, `side="B"` mirrors them to the back |
| `<footprint>` | `ref` | `value` = "", `id` = "", `at`, `side`, `fields` = {}, `bom` = true, `pos` = true, `dnp` = false, `nets`, `net:*`, `description`, `height` = 1, `model`, `netTie` | a plain footprint, not nested; `dnp`, also on a part or placement, keeps it out of the BOM and placement file but in the DRC; `netTie`, see Pads below |
| `<pad>` | `num`, `size` | `name` = num, `at`, `shape`, `drill`, `type`, `layers`, `roundness` = 0.25, `points`, `net`, `nc`, `maskExpansion`, `mask`, `paste` = true for smd, `pasteShrink`, `pasteRatio`, `thermal` | see Pads below |
| `<track>` | `layer`, `width` | `net`, `d`, `points`, `layers`, `via`, `auto`, `lock`, `viaInPad` | copper track; `route()` makes these, see routing.md |
| `<via>` | `at` | `net`, `drill`, `size`, `layers` = ["F.Cu", "B.Cu"] | without sizes it is the default via, see rules.md |
| `<zone>` | `layer`, `d` | `net`, `clearance` = rules.clearance, `priority` = 0, `minWidth` = rules.zoneMinWidth, `connect` = "thermal", `islands` = rules.islands | a copper pour; higher priority fills first; the fill keeps the larger of `clearance`, the net class clearance and a pad's override from other nets; see pours.md |
| `<stitch>` | `net` | `pitch` = 4, `layers`, `padClearance`, `via`, `avoid`, `area`, `grid`, `origin` | stitching vias from the fill of the net's pours, see pours.md |
| `<keepout>` | `d` | `layer` or `layers` = every copper layer, `tracks` = true, `vias` = true, `pours` = true, `except` = none | a hard keepout, see below |
| `<path>` | `layer`, `d` | `width`, `fill` = false, `net` | stroked or filled SVG path; on copper it is copper |
| `<line>` | `layer`, `x1`, `y1`, `x2`, `y2` | `width` | |
| `<circle>` | `layer`, `r` | `cx` = 0, `cy` = 0, `width`, `fill` = false | |
| `<rect>` | `layer`, `x`, `y`, `w`, `h` | `rx` = 0, `width`, `fill` = false | `x`, `y` is the top-left corner |
| `<text>` | `layer` | `at`, `size` = 1, `thickness`, `width` = size, `anchor` = "middle", `font` = "hershey", `thicken`, `net` | see Text below |

- The default stroke width of `path`, `line`, `circle` and `rect` is 0.05 on `Edge.Cuts` and courtyards, 0.15 on silkscreen and 0.1 elsewhere.
- Path data takes every SVG command, absolute and relative, in mm. The checks use it flattened with a 5 µm chord error. A circular arc, `<circle>` and the corners of `<rect rx>` stay arcs for the Gerbers and the SVG; Bezier curves and elliptical arcs reach them as segments. See fab-set.md.
- Every `net` prop takes a `Net` or a string. Parts from the schematic are placed as their own elements, see schematic.md.

## Pads

- `size` is a diameter or `[w, h]`. `drill` is a diameter or `[w, h]` for a slot.
- `type` is `smd`, `tht` or `npth`. Default `tht` with a drill, else `smd`.
- `shape` is `circle`, `rect`, `roundrect`, `oval` or `custom`. Default `roundrect` for smd, `circle` otherwise. A `custom` pad is the polygon `points`, `[x, y]` pairs in the pad's own frame before its rotation, with `size` its bounding box; the KiCad importer writes trapezoid, chamfered, offset and custom pads this way, see import.md.
- `layers` defaults to `["F.Cu"]` for smd, every copper layer for tht, none for npth. A tht pad may list fewer copper layers, as KiCad's `remove_unused_layers` leaves it: the barrel joins the listed layers, and on the others its hole keeps `holeClearance` from all copper, a pour of its own net included.
- `roundness` is the corner radius as a fraction of the shorter side.
- `paste` is true for the pad shape, false for none, polygons in the pad frame, or `{ rows, cols, coverage = 0.5 }`, a window grid for an exposed pad. `pasteShrink` shrinks it per side; `pasteRatio` grows it per side by that fraction of the pad size, negative to shrink, KiCad's paste ratio. The exporters draw the result, `pasteRings`.
- A non-plated hole opens the mask on both sides, `maskRings`, as KiCad opens every NPTH pad: its pad grown by the mask expansion, or its hole when the pad has no copper and is no larger than the drill. `mask={false}` opens none.
- `netTie` on `<footprint>` or on the metadata of `defineFootprint` lists pad groups by number, `[['1', '2'], ['3', '4']]` for a Kelvin shunt, KiCad's `net_tie_pad_groups`: the copper of pads of one group may touch without a `short`, each pad keeps its net, the ratsnest and routes treat the nets apart, and the importer carries it.
- `nc` marks the pad unconnected on purpose: it takes no net and belongs to no pin, see schematic.md.
- `thermal` is how the pad joins a pour of its net, over the pour's `connect`: `'thermal'`, `'solid'` or `'none'`. See pours.md.

## Helpers

`pour`, `via`, `keepout` and `stitch` from `@pcbjs/core` return the same nodes as the elements. Each has a positional form and an object form with the element's props.

```text
pour(net, layer, d, { clearance?, priority?, minWidth?, connect?, islands? }?)   // <zone />
via(net, at, { drill?, size?, layers? }?)                     // <via />
via(pin, at, { drill?, size?, layers? }?)                     // <via />, the net of a pin or pad handle
keepout(layers, d, { tracks?, vias?, pours?, except? }?)      // <keepout />, layers is a name, a list or 'all'
stitch(net, { pitch?, layers?, padClearance?, via?, avoid?, area?, grid?, origin? }?)   // <stitch />, see pours.md
pour(props); via(props); keepout(props); stitch(props)        // the object forms
```

```tsx
{via(VCC, '15.8 11.6')}
{pour(GND, 'B.Cu', rect(30, 20))}
{keepout('B.Cu', circle(6, 20, 10))}
{keepout('all', rect(13.2, 5.4, 0, 0), { pours: false })}
```

### Vias

`via(J1.B6, '11.25 6.2')` takes its net from a pin or pad handle, the same as `via(J1.B6.net, '11.25 6.2')`; a pin connected to `NC` has no net to give. A via is also a route end: `route(J1.B6).Z(v)` ends at `v` on the layer the route arrives on, and `route(v).X(U1[3])` starts from it, on the route's `.layer()` when the via spans it. Place the via and the route in the same `<g>`, whose frame its position is read in. Children may be any iterable, so a generator can yield each via beside its stub; it is read once, when the board compiles.

## Shapes

`@pcbjs/lib` returns SVG path strings for outlines, cutouts, pours and keepouts:

```text
rect(w, h, x = 0, y = 0)              // top-left corner at x y
roundedRect(w, h, r, x = 0, y = 0)    // corners of radius r, clamped to half the shorter side
circle(d, cx = 0, cy = 0)             // diameter d, centred at cx cy
slot(x1, y1, x2, y2, w)               // a slot w wide with round ends, centre line between the points
```

`<path layer="Edge.Cuts" d={roundedRect(30, 20, 2)} />` is an outline. The same call inside it is a cutout.

- The direction a ring is drawn in does not matter: a ring inside the outline is a cutout, a ring inside a cutout is board again, and pours keep `edgeClearance` from every edge either way.
- `rules={{ edge: { width: 1.2, except: [J1] } }}` keeps courtyards, silk and pads out of a band along the outline and round each cutout, for an enclosure's wall, with edge connectors let in by `except`; see rules.md Edge band.
- A cutout that crosses the outline or lies off the board is a DRC error `cutout-outside`.
- A pour may sit in a hole of another net's pour, at any depth; the Gerbers write the outer pour before the islands in its holes.

Rounded corners, circles and slot ends are `A` commands and reach the Gerbers as arcs.

## Keepouts

A `<keepout>` is a hard rule for copper inside an area.

- `d` is an SVG path; each closed subpath is one area. A path with no closed area is a compile error.
- `layer` or `layers` name copper layers. `'all'`, or neither, means every copper layer. A non-copper layer is a compile error.
- `tracks`, `vias` and `pours` say what may not enter: true forbids that kind, false lets it in. Each defaults to true, so `keepout(l, d, { pours: false })` keeps tracks and vias out and lets pours fill.
- `except` lists nets whose copper may enter anyway, in the DRC, pour clearing and the router: `keepout('B.Cu', d, { except: [OSC_IN, OSC_OUT] })` keeps foreign copper from under a crystal while its own nets hop through. It takes nets or net names.
- The router never places a forbidden track or via inside it. A track keeps its centre line half its width outside.
- Pours are cut by it. A pour it leaves with no fill at all is the DRC warning `pour-in-keepout`, naming the pour and the keepout.
- Copper of a forbidden kind inside it is the DRC error `keepout`, naming the item and the keepout's source line.
- Pads are never flagged: a keepout stops routing and pours, not parts.
- A keepout inside a footprint moves with the footprint. `ESP32C3Mini1` uses one under its antenna.

Use a keepout, not the router's `avoid`, when copper must stay out. `avoid` is a soft cost that the router crosses when it has no other way, see autorouter.md.

## Silk refs

Each ref goes on its side's silk at the first clean spot above, below, left or right of the courtyard as it reads, then the corners, flush with an end, then off it. Clean is clear of mask openings plus `silkToPad`, text, labels, silk, courtyards and the edge or `edge` band. Else it takes a pad-free spot inside its courtyard, the least overlapping candidate, or the nearest spot within 3 mm. Identical parts in a row the same way round share a side clean for all, so caps in a line align.

- It reads left to right, or bottom to top on a part turned a quarter, mirrored on the back.
- Its height is 0.2 of the courtyard's short side, from `silkMinHeight`, 1 mm in `BASE` and 0.8 in `PCBWAY`, to 1.2 mm; its stroke 0.15 of that, at least `silkMinWidth`.
- A part too small to hold its label with no spot within 1 mm is named in the ERC info `silk-ref-hidden`, a larger one in the warning `silk-ref`. A footprint without pads or with its own ref on silk gets none.

Test points, pogo pads, fiducials and mounting holes get no automatic ref and no 3D body: one pad out of the BOM and placement file or with an id saying test point, test pad, pogo or fiducial, one drilled pad without copper, or only drilled pads on such an unlisted part or a mounting hole. A `refAt` still draws one.

```tsx
<R1 at="10 5" ref={false} />
<U1 at="20 10" refAt="0 -4.5 0" />
<footprint ref="J9" at="3 3" refAt={false}><pad num={1} size={[1, 1]} /></footprint>
```

- `<PCB silkRefs={false}>` draws none on the whole board. `ref={false}` on a placed part, or `refAt={false}` on it or on a `<footprint>`, drops one.
- `refAt` is `"x y rot"` in the footprint's frame, used as given and turned upright; other labels keep clear of it.

## Text

```tsx
<text layer="F.SilkS" at="10 12" size={1}>Hello</text>
<text layer="B.SilkS" at="15 8.3" size={0.8} anchor="start">{'C1\n100n'}</text>
```

- The children are the text. A newline starts a new line, 1.6 times `size` below.
- The compiler draws it the same everywhere, never with an SVG `<text>` font: Hershey Simplex strokes, NewStroke strokes with `font="newstroke"`, or with `font` an outline font's filled glyphs.
- `size` is the cap height in mm in every font. `width`, KiCad's text width, stretches glyphs across the baseline; default `size`.
- `thickness` is the stroke width: on silk `silkMinWidth` by default and never less, elsewhere 0.15. Outline text has none; `thicken` grows its thin parts.
- `at` is the horizontal anchor point and the vertical centre of the block. `anchor` is `start`, `middle` or `end`, per line.
- `B.*` text is mirrored to read from below. Copper text is copper, with its `net` if any.
- A character outside the font is a box, or the font's .notdef, with one warning per board.

fonts.md has both fonts, sizes, the silk rule and licensing. `strokeText` of `@pcbjs/lib/fonts` gives the strokes for a `<path>`, see stdlib.md.
