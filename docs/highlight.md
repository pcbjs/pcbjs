# Highlight

What the token under the editor cursor names and what the highlight and hover show for it, and the source ranges every item carries.
Read it to know what a cursor or a hover will pick; editor.md has the rest of the editor integration.

## Symbols under the cursor

The language server resolves the innermost token at the cursor with a TypeScript language service on the project's tsconfig: the declaration gives the name, the `$$` brand of its type the kind, the board's source positions the items. Hover and the cursor highlight use it; elsewhere in `route(U1.VSSA, '24.375 17.6')` the route's range answers. A cursor right before or after a token is outside it.

| Token | Target: highlight, hover image |
| --- | --- |
| `U1` in `U1.VSSA`, `<U1 />`, `<sch.U1 />`, `const U1 = …`; `C3` in `group('P1', { C3: … })` | part: its courtyard, its land pattern |
| `VSSA` in `U1.VSSA`, `J1[3]`, `J1.pad(3)`, `'U1.3'`, `VDD` in `U1.connect({ VDD: … })` | pad: that pad, the land pattern with it outlined |
| `GND` in `nets()`, a connect map or a route; `g.ports.VCC`, `CH1.nets.led` | net: its copper |
| `P1` of `group('P1', …)`, an instance such as `CH1`, `g` in a layout | group: its parts |
| `'24.375 17.6'` as a route end, waypoint, via or `at` | point: a ring and a cross; a part's `at` where each instance went, else board mm |
| `reference('../x/pcb.tsx', …)` | reference: its outline |

With `import * as sch from './board.sch'` and `<PCB schematic={sch}>`, names the compiler injects bare resolve as `sch.U1` does: the server reads the injected text through @pcbjs/compile and maps positions back.

The dev server sends it to the viewers as `target` on `pcbjs:cursor`, `{ kind, boards: [{ board, name, ids, refs, points?, reference? }] }`; a viewer highlights `ids` and `refs` as any source highlight, tinted by area in 3D, marks `points` and outlines `reference` in 2D, and names it in the chip.

In dev a click on a pad selects its key in its part's connect call, `K` in `.connect({ A: SIG, K: GND })`, or its positional argument: the viewer adds `pad=REF.NUM` and `board` to `/__pcbjs/open`, and the language server finds the key.

## Source ranges

A Vite transform runs before esbuild on every `.ts` and `.tsx` file under the project root, outside `node_modules` and `.pcbjs`. It adds a `__src` prop to every JSX element and to every `route`, `pour`, `via`, `stitch` and `keepout` call imported from `@pcbjs/core`, under any name, and `.__at(range)` after each command of a route chain, from the method name to the closing parenthesis:

```text
route(J1[3], { __src: { file: "pcb.tsx", line: 8, col: 6, endLine: 8, endCol: 17 } }).V(14).__at({ file: "pcb.tsx", line: 8, col: 19, endLine: 8, endCol: 23 })
```

A call inside a function also carries `fn`, the lines of the innermost function around it that is not a callback argument; the call site of a helper route is the first stack frame outside it. A path string, the `d` of an element or of `pour` or the path of `route(a, b, path)`, also carries `lit`, where its text starts, and `raw: true` when it has no escapes or template expressions; the compiler then gives each command its own range, with `seg` such as `"H 9"`.

`file` is relative to the project root with forward slashes; `line`, `col`, `endLine` and `endCol` are 1-based, the end inclusive and the `>` of the closing tag for an element with children, columns in UTF-16 code units. In the site data's `sources`, a range lists in `outer` the ids it reaches only as a call site, such as a layout element around a pour, so a click opens the call that drew the item rather than a shorter element around it. Files without JSX that import nothing from `@pcbjs/core` are not touched. It emits a source map.

## Hover preview

The extension's hover starts with a 360 px wide crop of the board's 2D view with a scale bar, the item highlighted as the viewer highlights it and other copper faded:

- a placement: its courtyard dashed and its pads outlined, with ref, value, footprint, position and side below; a route call, a path command, a pour, a via or a text: what it drew, outlined in the accent; a builder chain command with no range of its own shows its whole route.
- a token that names a part, a pad, a net, an instance, a point or a reference: what the table in Symbols under the cursor says; a keepout call: its rings; a net name the symbols miss, such as `UP.DP`: the whole net, its pads named up to 24.
- a footprint factory call such as `R0603('10k')`, `kicadFootprint('Lib:Name')` or `const HUB = QFN(64, …)`: the land pattern in the footprint's own frame with pad numbers.
- a `model` file path: the land pattern under it, the mesh state and size.
- schematic code, a part element or `<Sym>` inside `<Schematic>`, a `<Label>`, `<Power>`, `<Sheet>` or `wire()` chain: what it drew, cropped from the schematic in its dark colours and outlined in the accent.
