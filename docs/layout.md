# Layout

The elements a board is drawn with, the `pour`, `via` and `keepout` helpers, the shape helpers, hard keepouts and text.
Routes are in routing.md, parts and their placement props in schematic.md, and pours, thermal reliefs, islands and `stitch()` in pours.md.

```tsx
<path layer="Edge.Cuts" d={roundedRect(30, 20, 2)} />
<text layer="F.SilkS" at="10 12" size={1}>Hello</text>
{via(VCC, '15.8 11.6')}
{pour(GND, 'B.Cu', rect(30, 20))}
{keepout('B.Cu', circle(6, 20, 10))}
{keepout('all', rect(13.2, 5.4, 0, 0), { pours: false })}
```

## Elements

Lengths are mm numbers or strings with a unit. Every `net` prop takes a `Net` or a string; parts are placed as their own elements, see schematic.md.

| Element | Required | Optional, `= default` | Notes |
| --- | --- | --- | --- |
| `<g>` | | `at` = "0 0 0", `side` | transforms its children; `side="B"` mirrors to the back |
| `<footprint>` | `ref` | `value` = "", `id` = "", `at`, `side`, `fields` = {}, `bom` = true, `pos` = true, `dnp` = false, `nets`, `net:*`, `description`, `height` = 1, `model`, `netTie` | `dnp`: out of BOM and placement, still in DRC |
| `<pad>` | `num`, `size` | `name` = num, `at`, `shape`, `drill`, `type`, `layers`, `roundness` = 0.25, `points`, `net`, `nc`, `maskExpansion`, `mask`, `paste` = true for smd, `pasteShrink`, `pasteRatio`, `thermal` | see Pads |
| `<track>` | `layer`, `width` | `net`, `d`, `points`, `layers`, `via`, `auto`, `lock`, `viaInPad` | `route()` makes these |
| `<via>` | `at` | `net`, `drill`, `size`, `layers` = ["F.Cu", "B.Cu"] | no sizes: the default via, rules.md |
| `<zone>` | `layer`, `d` | `net`, `clearance` = rules.clearance, `priority` = 0, `minWidth` = rules.zoneMinWidth, `connect` = "thermal", `islands` = rules.islands | pours.md |
| `<stitch>` | `net` | `pitch` = 4, `layers`, `padClearance`, `via`, `avoid`, `area`, `grid`, `origin` | pours.md |
| `<keepout>` | `d` | `layer` or `layers` = all copper, `tracks` = true, `vias` = true, `pours` = true, `except` = none | see Keepouts |
| `<path>` | `layer`, `d` | `width`, `fill` = false, `net` | on copper it is copper |
| `<line>` | `layer`, `x1`, `y1`, `x2`, `y2` | `width` | |
| `<circle>` | `layer`, `r` | `cx` = 0, `cy` = 0, `width`, `fill` = false | |
| `<rect>` | `layer`, `x`, `y`, `w`, `h` | `rx` = 0, `width`, `fill` = false | `x y` is the top-left corner |
| `<text>` | `layer` | `at`, `size` = 1, `thickness`, `width` = size, `anchor` = "middle", `font` = "hershey", `thicken`, `net` | see Text |

- Default stroke width: 0.05 on `Edge.Cuts` and courtyards, 0.15 on silk, 0.1 elsewhere.
- `d` takes every SVG command in mm, checked to a 5 µm chord. Circular arcs stay arcs in the Gerbers, Beziers and elliptical arcs become segments, fab-set.md.

## Pads

| Prop | Values | Default |
| --- | --- | --- |
| `size` | diameter or `[w, h]` | |
| `drill` | diameter, or `[w, h]` for a slot | |
| `type` | `smd`, `tht`, `npth` | `tht` with a drill, else `smd` |
| `shape` | `circle`, `rect`, `roundrect`, `oval`, `custom` | `roundrect` for smd, else `circle` |
| `points` | `custom` polygon, `[x, y]` in the pad frame before rotation; `size` is its box | |
| `layers` | copper layers | `["F.Cu"]` smd, all copper tht, none npth |
| `roundness` | corner radius over the shorter side | 0.25 |
| `paste` | true, false, polygons in the pad frame, or `{ rows, cols, coverage = 0.5 }` | true for smd |
| `pasteShrink`, `pasteRatio` | per side, mm or fraction of pad size, negative shrinks | |
| `mask` | `false` opens no mask | |
| `nc` | unconnected on purpose: no net, no pin, schematic.md | |
| `thermal` | `'thermal'`, `'solid'`, `'none'`, over the pour's `connect`; pours.md | |

- The importer writes trapezoid, chamfered, offset and custom KiCad pads as `custom`, import.md.
- A tht pad on fewer layers, KiCad's `remove_unused_layers`, keeps `holeClearance` from all copper on the rest.
- The exporters draw `pasteRings` and `maskRings`; an npth pad opens the mask on both sides, as KiCad does.
- `netTie`, on `<footprint>` or `defineFootprint` metadata, is KiCad's `net_tie_pad_groups`: `[['1', '2'], ['3', '4']]` lets pads of a group touch with no `short`; each keeps its net.

## Helpers

`pour`, `via`, `keepout` and `stitch` from `@pcbjs/core` return the element nodes, positional or as one props object.

```text
pour(net, layer, d, { clearance?, priority?, minWidth?, connect?, islands? }?)   // <zone />
via(net | pin, at, { drill?, size?, layers? }?)              // <via />
keepout(layers, d, { tracks?, vias?, pours?, except? }?)      // layers: a name, a list or 'all'
stitch(net, { pitch?, layers?, padClearance?, via?, avoid?, area?, grid?, origin? }?)
```

### Vias

```tsx
{via(J1.B6, '11.25 6.2')}
```

- A pin or pad handle gives its net, as `J1.B6.net`; a pin on `NC` has none.
- A via is a route end, `route(J1.B6).Z(v)` or `route(v).X(U1[3])`; keep both in one `<g>`.
- Children may be any iterable, read once, so a generator can yield each via beside its stub.

## Shapes

`@pcbjs/lib` returns SVG path strings:

```text
rect(w, h, x = 0, y = 0)              // top-left corner at x y
roundedRect(w, h, r, x = 0, y = 0)    // r clamped to half the shorter side
circle(d, cx = 0, cy = 0)             // diameter d
slot(x1, y1, x2, y2, w)               // round ends, centre line between the points
```

- On `Edge.Cuts` a ring inside the outline is a cutout, either winding; a ring in a cutout is board again.
- A cutout crossing the outline or off the board is the DRC error `cutout-outside`. Pours keep `edgeClearance` from every edge.
- `rules={{ edge: { width: 1.2, except: [J1] } }}` keeps courtyards, silk and pads out of a band along every edge, rules.md Edge band.
- A pour may sit in another net's pour hole at any depth.

## Keepouts

```tsx
{keepout('B.Cu', rect(4, 3, 10, 5), { except: [OSC_IN, OSC_OUT] })}
```

- `d` is a path; each closed subpath is an area. No closed area, or a non-copper layer, is a compile error.
- `layer` or `layers`: copper layers; `'all'` or neither is every one.
- `tracks`, `vias`, `pours`: true forbids that kind, each default true.
- `except`: nets or net names let in, in DRC, pour clearing and the router.
- The router keeps forbidden copper out and pours are cut; a pour left empty is the warning `pour-in-keepout`, forbidden copper inside the error `keepout`. Pads are never flagged.
- A keepout in a footprint moves with it; `ESP32C3Mini1` has one under its antenna.
- The router's `avoid` is only a cost it crosses when it must, autorouter.md.

## Silk refs

```tsx
<R1 at="10 5" ref={false} />
<U1 at="20 10" refAt="0 -4.5 0" />
<footprint ref="J9" at="3 3" refAt={false}><pad num={1} size={[1, 1]} /></footprint>
```

- Placed at the first spot beside the courtyard clear of mask plus `silkToPad`, silk, courtyards and the edge band, else inside it or within 3 mm; a row of identical parts shares a side. It reads upright, mirrored on the back.
- Height 0.2 of the courtyard's short side, from `silkMinHeight`, 1 in `BASE`, 0.8 in `PCBWAY`, to 1.2 mm; stroke 0.15 of it, at least `silkMinWidth`.
- No spot within 1 mm: ERC info `silk-ref-hidden` for a tiny part, warning `silk-ref` otherwise.
- `<PCB silkRefs={false}>` drops all; `ref={false}` or `refAt={false}` one. `refAt` is `"x y rot"` in the footprint frame, turned upright.
- Test points, pogo pads, fiducials, mounting holes, padless footprints and ones with their own silk ref get no ref, unless `refAt` is given, and no 3D body.

## Text

```tsx
<text layer="B.SilkS" at="15 8.3" size={0.8} anchor="start">{'C1\n100n'}</text>
```

| Prop | Meaning |
| --- | --- |
| children | the text; `\n` starts a line 1.6 × `size` below |
| `size` | cap height in mm |
| `width` | KiCad text width, stretches glyphs, default `size` |
| `thickness` | stroke; on silk `silkMinWidth` and never less, else 0.15 |
| `font` | `"hershey"` Simplex strokes, `"newstroke"`, or an outline font, filled |
| `thicken` | grows thin parts of outline text |
| `at`, `anchor` | horizontal anchor and block centre; `start`, `middle`, `end` per line |

- Never an SVG `<text>` font. `B.*` text is mirrored. Copper text is copper with its `net`.
- A missing glyph is a box or `.notdef`, one warning per board. fonts.md has fonts and licences; `strokeText` of `@pcbjs/lib/fonts` gives strokes for a `<path>`, stdlib.md.
