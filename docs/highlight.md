# Highlight

What the token under the editor cursor names, how each view draws hover, the selection and findings, and the source ranges every item carries.
Advanced. Read it to know what a cursor or a hover will pick; viewer.md has the selection, editor.md the rest of the editor integration.

## Symbols under the cursor

| Token | Target: what it selects, hover image |
| --- | --- |
| `U1` in `U1.VSSA`, `<U1 />`, `<sch.U1 />`, `const U1 = …`, `C3` returned by a circuit build | part: its courtyard, its land pattern |
| `VSSA` in `U1.VSSA`, `J1[3]`, `J1['B4']`, `VDD` in `U1.connect({ VDD: … })` | pad: that pad, the land pattern with it outlined |
| `GND` in `nets()`, a connect map or a route; `g.ports.VCC`, `CH1.nets.led` | net: its copper |
| an instance such as `CH1`, `g` in a layout | group: its parts |
| `'24.375 17.6'` as a route end, waypoint, via or `at` | point: a ring and a cross; a part's `at` where each instance went, else board mm |
| `reference('../x/pcb.tsx', …)` | reference: its outline |

- The language server resolves the innermost token on the project's tsconfig; the `$$` brand of its type gives the kind. Elsewhere in `route(U1.VSSA, '24.375 17.6')` the route's range answers.
- With `import * as sch from './board.sch'` and `<PCB schematic={sch}>`, bare injected names resolve as `sch.U1`, read through @pcbjs/compile.
- The target becomes the board's selection, its members in the grammar of refs.md, `D1/1`, `net:GND`, `CH1`, the same in the hover image; a point or a reference is no member and is marked instead, `marks` of the selection. A token naming nothing falls back to the innermost code range and what it drew. In schematic-only code a cursor inside a `wire()` or a `<Label>` marks what it drew on the sheet, `marks.sch` such as `['wire:3']`, and one inside a placed symbol selects its part.
- A selected pad goes to the editor as its key in the connect call, `K` in `.connect({ A: SIG, K: GND })`, or its positional argument; `/__pcbjs/open` takes `pad=REF/NUM` and `board` for the same.

## Highlight states

One accent for selection in every view, `--accent`; findings keep their colours, errors red, warnings orange, info a hollow ring.

| State | 2D | 3D | Schematic |
| --- | --- | --- | --- |
| hover | 2 px outline, white at 50 percent | 1.5 px silhouette, white at 50 percent | halo, `--canvas-fg` at 50 percent |
| selected | 2 px accent over a 1 px casing, 10 percent fill | 1.5 px accent silhouette, 35 percent through what hides it, a faint rim | halo, symbol tint 10 percent |
| anchor | 2.5 px | 2 px | a wider halo |
| context | the anchor's net and pair mates, 1 px accent at 40 percent | silhouette at 40 percent | halo at 40 percent |
| stale | 50 percent, outline dashed | 50 percent | 50 percent |
| finding | marker, the focused one with a 2 px ring | marker, always visible when buried | marker on the sheet |

- No flood and no pulse on a selection, a 120 ms fade in. The focus fade fades what is neither selected nor context, to 0.25 in 3D, 45 percent and saturation 0.3 in 2D; hover fades nothing.
- A part outlines its courtyard, else its extent; a pad its shape; a route its tracks and vias; a net all its copper; a control point is a 6 px accent dot with a white ring.
- Copper merged per net shows one selected item: 2D copies the item's element, 3D draws the item's own geometry into the outline's id buffer and a depth-biased overlay, never by showing the hidden item mesh. A part, pad or track lights only its own copper there, the merged mesh fading and isolating as the rest of its net; the merged mesh lights only for a whole net, the context net or a pair. `pcbjs shot --select` draws the same, render.md.
- Board references take no hover or click; a cursor inside `reference(` outlines one.

## Source ranges

A Vite transform on every `.ts` and `.tsx` outside `node_modules` and `.pcbjs` adds `__src` to each JSX element and each `route`, `pour`, `via`, `stitch` and `keepout` call from `@pcbjs/core`, and `.__at(range)` after each chain command:

```text
route(J1[3], Q1[1], { __src: { file: "pcb.tsx", line: 8, col: 6, endLine: 8, endCol: 24 } }).V(14).__at({ file: "pcb.tsx", line: 8, col: 19, endLine: 8, endCol: 23 })
```

| Field | Meaning |
| --- | --- |
| `file` | relative to the project root, forward slashes |
| `line`, `col`, `endLine`, `endCol` | 1-based, end inclusive, the `>` of the closing tag for an element with children; columns in UTF-16 units |
| `fn` | lines of the innermost enclosing function that is not a callback; a helper route's call site is the first frame outside it |
| `lit`, `raw: true` | a path string, `d` of `<path>` or the area of `pour()` and `keepout()`: where its text starts, and no escapes or template expressions; each command then gets a range with `seg` such as `"H 9"` |
| `outer` | in the site data's `sources`: uids a range reaches only as a call site, so Open placement in the chip opens the call that drew the item |

Files without JSX or a `@pcbjs/core` import are left alone; it emits a source map.

## Hover preview

A 360 px crop of the 2D view with a scale bar, the item highlighted, other copper faded.

| Hovered | Shows |
| --- | --- |
| a placement | courtyard dashed, pads outlined; ref, value, footprint, position, side below |
| a route call, path command, pour, via, text | what it drew in the accent; a chain command with no range shows its whole route |
| a symbol token from the table above | its target; a keepout call its rings; a net the symbols miss, such as `UP.DP`, the whole net with up to 24 pads named |
| a footprint factory, `R0603('10k')`, `kicadFootprint('Lib:Name')`, `const HUB = QFN(64, …)` | the land pattern in its own frame with pad numbers |
| a `model` path | the land pattern under it, mesh state and size |
| a part element or `<Place>` in `<Schematic>`, `<Label>`, `<Power>`, `<Sheet>`, `wire()` | what it drew, cropped from the schematic in dark colours |
