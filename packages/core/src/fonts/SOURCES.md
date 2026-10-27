# Sources of the stroke font data

Where each table in this folder comes from, its licence, and how it was converted. docs/fonts.md has the same provenance for readers of the docs.

## hershey-simplex.ts

- The C array `simplex[95][112]` on Paul Bourke, "Hershey Vector Font", http://paulbourke.net/dataformats/hershey/, fetched 2026-10-23, cross-checked against `futural.jhf` of https://github.com/kamalmostafa/hershey-fonts.
- Licence: the Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821. The data may be used by anyone for any purpose, commercial or otherwise, and may be converted into any format except the one the U.S. NTIS distributes. This acknowledgement travels with the data, in the header of `hershey-simplex.ts`.

## newstroke.ts

- Font: NewStroke by Vladimir Uryvaev, the stroke font KiCad draws its text in.
- Source: `newstroke_font.cpp` in `newstroke-font.tgz` from the author's page http://vovanium.ru/sledy/newstroke/en, linked as http://vovanium.ru/_media/sledy/newstroke/newstroke-font.tgz, fetched 2026-10-26, SHA-256 `dba1c334834e21bdbd15395dc610ecc2bf2eb6675ba0c4585597b375b7bd099e`. The `.cpp` is dated 2010-05-26; the archive's README is dated 2015-11-18.
- Licence: CC0 1.0, http://creativecommons.org/publicdomain/zero/1.0/. The archive's README says "Previously released under CC-BY licence. Now released under CC0 licence, to give it right to be used in any project.", and the page says "It is released under CC0 licence which is effectively equivalent to public domain so you can do with it whatever you want." The GPL v2 header in the generated `.cpp` is KiCad's file boilerplate around the generated table.
- Conversion: `node packages/core/scripts/convert-newstroke.mjs <newstroke_font.cpp> > packages/core/src/fonts/newstroke.ts`. Each string is decoded as KiCad's `STROKE_FONT::loadNewStrokeFont` does: the first two characters are the left and right bounds, every following pair a vertex, each coordinate the character code minus `R`, a pair ` R` lifting the pen. x is taken from the left bound, y is flipped to grow up from the baseline at 9 units below `R`, the advance is the right bound minus the left. Code points the upstream table draws as its placeholder box are left out.
- Coverage: ASCII, U+00A0 to U+017F, U+0391 to U+03C9, U+2010 to U+2027, and U+2030, U+20AC, U+2122, U+2190 to U+2193, U+2212, U+221E, U+2248, U+2260, U+2264, U+2265. The ohm sign U+2126 is drawn as U+03A9, as KiCad's table does.
- Compared with KiCad's `common/newstroke_font.cpp` on master, 2026-10-26: every converted glyph draws the same ink, 17 in another stroke order and Ą with its ogonek as a separate stroke, except the tilde, which KiCad 6 and later draw 11 units lower, at the middle of the x-height, and the ohm sign, a box upstream. The converter lowers the tilde by the same 11 units. No data is copied from KiCad's GPL tree, and KiCad's CJK glyphs, Source Han Sans under the SIL OFL 1.1, are not included.
