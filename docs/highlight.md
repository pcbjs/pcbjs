# Highlight

What the token under the editor cursor names and what the highlight and hover show for it, and the source ranges every item carries.
Read it to know what a cursor or a hover will pick; editor.md has the rest of the editor integration.

## Symbols under the cursor

| Token | Target: highlight, hover image |
| --- | --- |
| `U1` in `U1.VSSA`, `<U1 />`, `<sch.U1 />`, `const U1 = …`; `C3` in `group('P1', { C3: … })` | part: its courtyard, its land pattern |
| `VSSA` in `U1.VSSA`, `J1[3]`, `J1.pad(3)`, `'U1.3'`, `VDD` in `U1.connect({ VDD: … })` | pad: that pad, the land pattern with it outlined |
| `GND` in `nets()`, a connect map or a route; `g.ports.VCC`, `CH1.nets.led` | net: its copper |
| `P1` of `group('P1', …)`, an instance such as `CH1`, `g` in a layout | group: its parts |
| `'24.375 17.6'` as a route end, waypoint, via or `at` | point: a ring and a cross; a part's `at` where each instance went, else board mm |
| `reference('../x/pcb.tsx', …)` | reference: its outline |

- The language server resolves the innermost token on the project's tsconfig; the `$$` brand of its type gives the kind. Elsewhere in `route(U1.VSSA, '24.375 17.6')` the route's range answers.
- With `import * as sch from './board.sch'` and `<PCB schematic={sch}>`, bare injected names resolve as `sch.U1`, read through @pcbjs/compile.
- The dev server sends `target` on `pcbjs:cursor`, `{ kind, boards: [{ board, name, ids, refs, points?, reference? }] }`; viewers light `ids` and `refs`, mark `points` and outline `reference`.
- In dev a click on a pad selects its key in the connect call, `K` in `.connect({ A: SIG, K: GND })`, or its positional argument: the viewer adds `pad=REF.NUM` and `board` to `/__pcbjs/open`.

## Source ranges

A Vite transform on every `.ts` and `.tsx` outside `node_modules` and `.pcbjs` adds `__src` to each JSX element and each `route`, `pour`, `via`, `stitch` and `keepout` call from `@pcbjs/core`, and `.__at(range)` after each chain command:

```text
route(J1[3], { __src: { file: "pcb.tsx", line: 8, col: 6, endLine: 8, endCol: 17 } }).V(14).__at({ file: "pcb.tsx", line: 8, col: 19, endLine: 8, endCol: 23 })
```

| Field | Meaning |
| --- | --- |
| `file` | relative to the project root, forward slashes |
| `line`, `col`, `endLine`, `endCol` | 1-based, end inclusive, the `>` of the closing tag for an element with children; columns in UTF-16 units |
| `fn` | lines of the innermost enclosing function that is not a callback; a helper route's call site is the first frame outside it |
| `lit`, `raw: true` | a path string, `d` or the path of `route(a, b, path)`: where its text starts, and no escapes or template expressions; each command then gets a range with `seg` such as `"H 9"` |
| `outer` | in the site data's `sources`: ids a range reaches only as a call site, so a click opens the call that drew the item |

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
| a part element or `<Sym>` in `<Schematic>`, `<Label>`, `<Power>`, `<Sheet>`, `wire()` | what it drew, cropped from the schematic in dark colours |
