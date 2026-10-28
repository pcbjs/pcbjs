# Fonts

The two kinds of font for `<text>`: stroke fonts, Hershey Simplex by default and KiCad's NewStroke, and outline fonts from TrueType and OpenType files drawn as filled glyphs.
Their size semantics, the silk text rule with its `thicken` guard, KiCad's text sizes, and the provenance and licences that must travel with the font data.

| Kind | `font` | Compiled item | Gerber |
| --- | --- | --- | --- |
| stroke, Hershey Simplex | default, `"hershey"`, `"hershey-simplex"` | `strokes`, polylines `thickness` wide, round ends | D01 strokes of a round aperture |
| stroke, NewStroke | `"newstroke"` | same, `font: "newstroke"` | same |
| outline | a name from `fonts`, or `{ file }` | `polys` in board mm, `font` the family and style, `strokes` empty, `thickness` 0 | one region per glyph piece, counters cut in with a cut line |

- Outline glyphs come from opentype.js, curves flattened to 1/2000 em and unioned with Clipper under the nonzero rule, so counters are holes.
- Both kinds reach the SVG, viewer, 3D view, Gerbers, DRC and `inspect` as the same geometry. On copper, text is copper with its `net`, in clearance, zone knock-outs and connectivity.

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

- `fonts` on `<PCB>` or in pcb.config.ts maps names to fonts; the board's names win. An unknown `font="name"` is a compile error listing the names.
- An entry is a path or `{ file, weight }`, relative to the file holding the literal, as a model path; an absolute path or `file:` URL as it is. A missing file is a compile error at the `<text>`.
- `weight` sets a variable font's `wght` axis, 700 for Bold, as FreeType applies it. A static font's weight is its file, `RobotoSlab-Bold.ttf`; pcbjs never emboldens.

## Metrics

| Font | Cap height | Advances |
| --- | --- | --- |
| Hershey Simplex | 21 units, `H` from y = 0 to 21; descenders 7 below | per glyph, bearings built in |
| NewStroke | 21 units, KiCad's glyph size, so `size` is KiCad's text height | KiCad's, its spacing included |
| outline | OS/2 `sCapHeight`, else the top of `H` | `hmtx`, varied by `gvar`, kerned by GPOS or `kern`; no ligatures or shaping |

| Prop | Meaning |
| --- | --- |
| `size` | cap height in mm; a font unit is `size / capHeight` mm |
| `width` | scales across the baseline by `width / size`; default `size`, as KiCad's text width |
| `at` | the anchor horizontally, the block's vertical centre, first cap line to last baseline; lines 1.6 x `size` apart; `anchor` per line |
| `B.*` layer | mirrored to read from below, also through `side="B"`; rotation about `at` |

Coordinates are rounded to 1 nm.

## KiCad's text sizes

Stroke: `(size 1.25 1.35) (thickness 0.2)` is `font="newstroke" size={1.25} width={1.35} thickness={0.2}`, height first.

- KiCad 7 to 9 put the first baseline h x 22/21 - 0.052 x thickness below a top-justified `at`, 0.585 x h higher centred, 1.17 x h bottom, and move left or right text in by thickness / 1.52.
- `kicadStrokeShift(text)` of `@pcbjs/kicad` gives the move from KiCad's `at`, -0.037381 x h - 0.052 x thickness down for centred text; `pcbjs import` applies it. On a scripted KiCad board it took the F.SilkS difference from 3.9 to 0.15 mm2 beyond 2 px.

TrueType: KiCad draws the font at an em of 1.4 x its size.

- `size` = 1.4 x KiCad height x capHeight / unitsPerEm, `width` likewise. Roboto Slab, cap 1456 of 2048: `(size 2 2)` is `size={1.990625}`, `(size 1.4 1.4)` is `size={1.393438}`.
- Centred baseline is 0.415 x height below `at`, from KiCad 9's render cache: move `at` by 0.415 x height minus half the pcbjs size, -0.165 mm for Roboto Slab at 2 mm.
- KiCad's `thickness` is ignored; `(bold yes)` is the bold file or weight 700.
- `kicadOutlineSize(font, height)` of `@pcbjs/core/outline` and `kicadOutlineText(font, [height, width])` of `@pcbjs/kicad/fonts`, with the shift, compute this for `pcbjs import`, see import.md. Roboto Slab bold ink lands within 0.012 mm of KiCad's.

## Silk text rule

| Case | Rule |
| --- | --- |
| stroke | never thinner than `silkMinWidth`, the default `thickness`: 0.15 mm in `BASE`, JLCPCB and PCBWay, 0.127 mm for OSH Park and Advanced PCB; a smaller `thickness` is raised |
| outline | DRC warning `silk-width` with the thinnest stroke, to 1 um, where an opening by `silkMinWidth` removes more than a `silkMinWidth` square; convex corners, serif ends and tips blunter than about 22 degrees do not count. Roboto Slab Thin at 1.2 mm has 0.04 mm hairlines |
| `thicken` | grows the outline by half the deficit so the thinnest stroke is `silkMinWidth`; bolder everywhere, so a bolder weight or size keeps the shapes |
| height | cap height 0.8 mm or more and about 5 x the line width; check the fab's minimum |
| pads | `silk-over-pad` tests every stroke and glyph against same-side mask openings, which the fab clips |
| Fab, User, Edge | stroke `thickness` defaults to 0.15 mm, used as given |

## Characters

- NewStroke: ASCII, Latin-1, Latin Extended-A, Greek, U+2010 to U+2027, and ‰ € ™ ← ↑ → ↓ − ∞ ≈ ≠ ≤ ≥; Ω is capital omega, as in KiCad.
- Hershey Simplex: ASCII 32 to 126, plus `·` and `°` in its style; en and em dashes, minus, curly quotes, no-break space and tab use ASCII look-alikes.
- Any other stroke character is a capital-sized box. An outline font draws what it has, `©` included, else `.notdef`. Either way one warning per board and font lists the missing characters.

## Licensing

A font file ships with the sources, so keep its licence beside it: `pcbjs import` writes a line per font to `fonts/LICENSES.md` from name table IDs 0, 13 and 14. OFL and Apache 2.0 allow the file in the project, and OFL leaves documents made with it free; a commercial font may restrict both.

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
