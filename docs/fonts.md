# Fonts

The two kinds of font for `<text>`: stroke fonts, Hershey Simplex by default and KiCad's NewStroke, and outline fonts from TrueType and OpenType files drawn as filled glyphs.
Their size semantics, the silk text rule with its `thicken` guard, KiCad's text sizes, and the provenance and licences that must travel with the font data.

## Two kinds

- Stroke: Hershey Simplex, the default, also `font="hershey"` or `"hershey-simplex"`, or NewStroke, KiCad's own stroke font, `font="newstroke"`. The compiler lays the string out into polylines, `strokes` on the compiled text item, drawn `thickness` wide with round ends. Legend Gerbers get D01 strokes of a round aperture.
- Outline: any `.ttf` or `.otf` file, read with opentype.js. Each glyph's contours, curves flattened to 1/2000 em, are unioned with Clipper under the nonzero rule, so overlapping contours merge and counters are holes. The compiled item has `polys`, filled polygons in board mm, with `font` naming the family and style; `strokes` is empty and `thickness` 0. Legend and copper Gerbers get one region per glyph piece, its counters cut in with a cut line, so they erase nothing drawn before.

Both kinds reach the per-layer SVG, the viewer, the 3D view, the Gerbers and the DRC as the same geometry. On a copper layer text of either kind is copper, with its `net` if it has one, and takes part in clearance, zone knock-outs and connectivity. `inspect` is the same for both.

## Naming an outline font

```tsx
import PCB from '@pcbjs/core'

export default (
  <PCB name="Label" fonts={{ slab: { file: './fonts/RobotoSlab-VariableFont_wght.ttf', weight: 700 } }}>
    <rect layer="Edge.Cuts" x={0} y={0} w={40} h={12} />
    <text layer="F.SilkS" at="20 4" size={2} font="slab">© 2025 Label</text>
    <text layer="B.SilkS" at="20 8" size={1.4} font={{ file: './fonts/RobotoSlab-Bold.ttf' }}>V1.0</text>
  </PCB>
)
```

- `fonts` on `<PCB>` maps names to fonts; `fonts` in pcb.config.ts does the same for every board, and a board's own names win. `font="name"` picks one; an unknown name is a compile error listing the names.
- An entry is a path or `{ file, weight }`. The path is relative to the file that holds the literal, as a model path is: the board file for `<PCB fonts>`, pcb.config.ts for the config, the `<text>`'s own file for `font={{ file }}`. An absolute path or a `file:` URL is taken as it is.
- `weight` sets the `wght` axis of a variable font, such as 700 for the Bold instance of `RobotoSlab-VariableFont_wght.ttf`. Outlines and advances follow the axis as FreeType applies it. A static font has its weight in its file: name `RobotoSlab-Bold.ttf` for bold. pcbjs never emboldens a regular file.
- Fonts are read in Node, when the board compiles; a missing file is a compile error at the `<text>`.

## Metrics

Hershey Simplex: caps are 21 font units tall, measured from `H`, which spans y = 0 to 21 above the baseline; descenders reach 7 units below. Each glyph carries its own advance, side bearings built in.

NewStroke: KiCad's glyph size is 21 units and caps span y = 0 to 21, so `size` is KiCad's text height. Advances are KiCad's, its spacing between glyphs included, and `width` scales them as KiCad's text width does. The compiled item has `font: "newstroke"`.

Outline fonts: the cap height is the font's OS/2 `sCapHeight`, else the top of `H`. Advances are the font's own `hmtx` widths, varied by `gvar` for a variable font, and pairs are kerned by the font's GPOS or `kern` table. Ligatures and other shaping are not applied.

In both kinds:

- `size` on `<text>` is the cap height in mm, so a font unit is `size / capHeight` mm.
- `width` scales across the baseline only, glyphs and advances by `width / size`; it defaults to `size`.
- Lines are 1.6 times `size` apart. `at` is the anchor point horizontally and the vertical centre of the block, from the cap line of the first line to the baseline of the last. `anchor` applies to each line on its own.
- Text on a `B.*` layer is mirrored so that it reads from below, whether it was written on the back or reached it through `side="B"`. Rotation turns about `at`.
- Coordinates are rounded to 1 nm after the transform.

## KiCad's text sizes

KiCad's stroke text maps one to one: `(size 1.25 1.35) (thickness 0.2)` is `font="newstroke" size={1.25} width={1.35} thickness={0.2}`, height first. KiCad 7 to 9 put the first baseline h x 22/21 - 0.052 x thickness below a top-justified `at`, 0.585 x h higher when centred, 1.17 x h when bottom, and move left or right justified text in by thickness / 1.52. `kicadStrokeShift(text)` of `@pcbjs/kicad` gives the move from KiCad's `at` to pcbjs's along the text's axes, -0.037381 x h - 0.052 x thickness down for centred text; `pcbjs import` applies it. On a scripted KiCad board, the connector and pin labels on NewStroke this way take the F.SilkS difference against KiCad's Gerber from 3.9 to 0.15 mm2 beyond 2 px, with the same ink box. KiCad's TrueType text is sized by the em, not the cap height: it draws the font at an em of 1.4 times its size. So in pcbjs:

- `size` = 1.4 x KiCad height x capHeight / unitsPerEm, and `width` the same of KiCad's width. Roboto Slab has a cap height of 1456 of 2048 units, so KiCad's `(size 2 2)` is `size={1.990625}`, and `(size 1.4 1.4)` is `size={1.393438}`.
- KiCad puts the baseline of centred TrueType text 0.415 x its height below `at`, measured from KiCad 9's render cache, so pcbjs's `at` is KiCad's moved by 0.415 x height minus half the pcbjs size, down the text's own axis: -0.165 mm for Roboto Slab at 2 mm.
- KiCad's `thickness` is ignored for TrueType text and pcbjs has none. `(bold yes)` is the bold file or weight 700.

`kicadOutlineSize(font, height)` of `@pcbjs/core/outline` and `kicadOutlineText(font, [height, width])` of `@pcbjs/kicad/fonts`, which adds the shift, compute this; `pcbjs import` uses them, see import.md. The ink of a Roboto Slab bold label lands within 0.012 mm of KiCad's.

## Design rule for silk text

- Stroke text is never thinner than `silkMinWidth`. Without `thickness` it is exactly `silkMinWidth`, 0.15 mm in `BASE` and in the JLCPCB and PCBWay presets, 0.127 mm for OSH Park and Advanced PCB. A smaller `thickness` is raised to it.
- Outline text on silk is checked as filled ink: wherever an opening by `silkMinWidth` removes a piece larger than a `silkMinWidth` square, the text gets the DRC warning `silk-width` with its thinnest stroke, measured to 1 um. Convex corners, the rounded ends of serifs and tips blunter than about 22 degrees do not count. Thin weights and small sizes trip it: Roboto Slab Thin at 1.2 mm has 0.04 mm hairlines.
- `thicken` on the `<text>` grows the outline outward by half the deficit, so its thinnest stroke prints at `silkMinWidth`, and the warning goes. The glyphs get bolder by the same amount everywhere; a bolder weight or a larger size keeps the design's shapes.
- Height: keep the cap height at 0.8 mm or more, and at least about 5 times the line width so the counters stay open. Check the fab's own minimum legend height before going smaller.
- Pads: `silk-over-pad` tests every stroke and every glyph against the mask openings of the same side. The fab clips silk off the openings, so a warning means part of a letter will be missing.
- Other layers: on Fab, User and Edge layers stroke `thickness` defaults to 0.15 mm and is used as given.

## Characters

NewStroke has ASCII, Latin-1, Latin Extended-A, Greek, the general punctuation from U+2010 to U+2027, and ‰ € ™ ← ↑ → ↓ − ∞ ≈ ≠ ≤ ≥; the ohm sign Ω is the capital omega, as in KiCad. Hershey Simplex has ASCII 32 to 126. pcbjs adds the middle dot `·` and the degree sign `°` in the same style; en and em dashes, the minus sign, curly quotes, the no-break space and tab are drawn with their ASCII look-alikes. Any other character is a box the size of a capital.

An outline font draws every character it has, `©` and other non-ASCII glyphs included. A character it lacks is drawn as its `.notdef` glyph. Either way the compiler prints one warning per board and font listing the missing characters.

## Licensing

A font file is software with its own licence, and the board's sources ship it. Keep the licence beside the file: `pcbjs import` writes a line per copied font to `fonts/LICENSES.md`, naming the font, its copyright and its licence from the name table, IDs 0, 13 and 14. The SIL Open Font License and Apache 2.0 allow the file in the project, and the OFL says documents made with the font are not bound by it; a commercial font may restrict both the file and its use. The README of the copied font's project is the place to check.

## Hershey Simplex provenance

The glyphs are the Simplex Roman set of the Hershey fonts, ASCII 32 to 126, 95 glyphs. The data in `packages/core/src/fonts/hershey-simplex.ts` was converted from the C array `simplex[95][112]` on Paul Bourke's page "Hershey Vector Font", http://paulbourke.net/dataformats/hershey/, fetched on 2026-10-23. Each glyph was compared with `futural.jhf` from https://github.com/kamalmostafa/hershey-fonts, the same font in James Hurt's original format: 86 of 95 glyphs match vertex for vertex. The other nine are punctuation that futural draws differently: `*`, `,`, `.`, `:`, `;`, `^`, `_`, the backquote and `{`.

The Hershey fonts are free to use. The distribution the data comes from carries this notice, which must travel with the font data:

- The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards.
- The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821.
- The data may be used by anyone for any purpose, commercial or otherwise, and may be converted into any format except the one the U.S. NTIS distributes.

The same acknowledgement is in the header comment of `hershey-simplex.ts`, which `tsc` keeps in `dist`. `strokeText` from `@pcbjs/lib/fonts` returns a stroke font's geometry for use in a `<path>`, NewStroke with `font: 'newstroke'`.

## NewStroke provenance

NewStroke is by Vladimir Uryvaev, made for KiCad as a multilingual replacement for Hershey. `packages/core/src/fonts/newstroke.ts` is generated by `packages/core/scripts/convert-newstroke.mjs` from `newstroke_font.cpp` in the author's `newstroke-font.tgz`, http://vovanium.ru/sledy/newstroke/en, fetched 2026-10-26. The author's README and page release the font under CC0 1.0, http://creativecommons.org/publicdomain/zero/1.0/; the GPL header of the generated `.cpp` is KiCad's file boilerplate. pcbjs copies no data from KiCad's GPL tree. KiCad's `common/newstroke_font.cpp` has the same Latin and Greek ink, some in another stroke order, but for the tilde, which KiCad 6 and later draw 11 units lower; the converter does the same. KiCad's CJK glyphs, from Source Han Sans under the OFL, are not included. `packages/core/src/fonts/SOURCES.md` has the checksum and the comparison.

The test font `packages/core/tests/fixtures/fonts/RobotoSlab-subset.ttf` is a subset of Roboto Slab, Apache License 2.0; the README beside it gives its source and the command that cut it.
