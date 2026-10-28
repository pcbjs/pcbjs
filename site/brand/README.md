# Brand

Logo candidates for pcbjs and the rules for using the chosen one. The owner picks a candidate; until then the site falls back to its default header.

## Folder

- `candidates/<n>/logo.svg` is the full-colour square mark on its own tile, viewBox `0 0 512 512`.
- `candidates/<n>/mark-mono.svg` is the same idea in one colour, `currentColor` on a transparent ground, for silkscreen, print, single-colour favicons and anywhere the tile does not fit.
- `candidates/<n>/wordmark.svg` is the tile beside "pcbjs" set in Inter, falling back to the system sans; its text colour follows `prefers-color-scheme`, so one file serves light and dark headers.
- `candidates/<n>/README.md` holds the idea and the colours in two lines.
- `candidates/9`, `9a`, `9b` and `9c` combine 3 and 7: the QFN body is the tile, its gold pads straddle the body edge half in and half out, and the `>_` prompt sits inside. They have no tile, so the ground between the pads is transparent. Pads are 64 wide with 32 gaps, so at 16 px they are 2 px with 1 px gaps; the mono mark draws the body as a 32-unit outline from 64 to 96 that runs through the solid pads, on whole pixels at 16 px.
- `9c1`, `9c2` and `9c3` try to fix the contrast of the 9c body: green mask `#1E6B46`, a silkscreen line inside the edge, and a body that is dark mask on light grounds and green mask on dark ones through `prefers-color-scheme`. A mark that switches ships a `static.svg` beside `logo.svg`, and the PNG renders use it, since a PNG cannot switch.
- Once the owner picks, the chosen files are copied to `logo.svg`, `mark-mono.svg` and `wordmark.svg` here, and `favicon.svg` is a copy of `logo.svg`. The site reads `logo.svg` and `favicon.svg` when they exist.
- `wordmark.svg` and `wordmark-mono.svg` here draw "pcbjs" as outlines of Inter at weight 650, optical size 32, 68 units high with -1.5 letter spacing and the font's kerning, so every renderer shows the same letters. `wordmark-mono.svg` is `mark-mono.svg` beside them in `currentColor`. `packages/lib/scripts/brand.mjs` turns `mark-mono.svg` and `wordmark-mono.svg` into the silk polygons of `<Brand>`; run it after changing either.

## Palette

Board colours plus one accent; a candidate uses a subset.

- Dark mask `#0F2219`, green mask `#1E6B46`, copper `#D07A3C`, ENIG gold `#E8B84F`, bare FR-4 `#D8C99B`, silkscreen `#F2EFE6`, package black `#0A0D0B`, accent cyan `#3FD8C8`.
- Wordmark text: `pcb` in `#16201B` on light and `#F2EFE6` on dark.
- The `js` letters always stand apart from `pcb`: copper `#D07A3C` on light, ENIG gold `#E8B84F` on dark, and in one colour an outline with no fill, a `currentColor` stroke 3.2 units wide on the glyph edge, as `wordmark-mono.svg` and the silk `<Brand>` draw it. Never set `js` in the colour of `pcb`.

## Generated PNGs

Every raster is rendered from the chosen SVG and checked in, so the site build needs no renderer.

- `favicon.svg` is served as is for browsers that take SVG icons.
- `favicon.ico` holds 16, 32 and 48 px renders of `logo.svg`, and `apple-touch-icon.png` is 180 px.
- `avatar.png` is a 512 px render of `logo.svg` for the GitHub organisation and npm; GitHub crops it to a circle. A mark with a transparent ground, such as candidate 9, is flattened on silkscreen `#F2EFE6` for the avatar, since GitHub shows it on either theme.
- `og.png` is 1200 by 630: `wordmark.svg` with its dark colours written in, scaled 2.5 times and centred on dark mask `#0F2219`, rendered with `rsvg-convert -w 1200 -h 630`. The site's `og:image` points at `/brand/og.png`.
- `icon.png` is a 512 px render of `logo.svg` on a transparent ground, `rsvg-convert -w 512 -h 512`, the VS Code extension listing icon, copied to `assets/icon.png` by the extension build.
- Renders use `rsvg-convert -w <px> -h <px>` and `magick` to pack the `.ico`; if the 16 px render of the chosen mark needs hinting, a hand-tuned `favicon-16.svg` beside it wins over `logo.svg` for that size.

## Safe area

- The mark's essential shapes stay inside a circle of radius 220 around the centre `256 256`, so the GitHub avatar crop never cuts them; the tile corners, any full-bleed background and the outer ends of chip pads may run to the edge.
- The tile is a 512 square with corner radius 112; never redraw it with another radius or put the mark on a second tile.
- Strokes and the gaps between shapes are at least 40 units, 1.25 px at 16 px; via holes are smaller and may close at 16 px, so no mark depends on a hole to be read.
- Clear space around the wordmark is the height of the `p` bowl on every side, and the wordmark is never shown below 20 px high; under that, use the mark alone.
- Do not recolour the full-colour mark; on a busy or coloured ground use `mark-mono.svg` in one colour that has contrast.
