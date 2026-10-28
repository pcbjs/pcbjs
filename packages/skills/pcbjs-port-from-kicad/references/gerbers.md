# Gerber comparison

The third correctness check of a port: both fab sets rendered on one frame and compared layer by layer. It catches what the netlist cannot: pour fills, mask openings, paste windows, silk and the outline.

## Method

1. KiCad's set from the same commit: the project's own fab target, or `kicad-cli pcb export gerbers --subtract-soldermask` and `kicad-cli pcb export drill --excellon-separate-th`. Use the saved fills as the reference.
2. pcbjs's set: `pcbjs build -q --date <iso>`, from `.pcbjs/fab/<board>/`.
3. Render each layer of both sets to SVG with `gerber-to-svg`, then to PNG at 25 to 50 px per mm with `resvg`, on one frame.
4. Per layer: the area in each set, the area only in KiCad and only in pcbjs, the area left after eroding the difference by one pixel, which drops slivers under about 80 µm, and the ink bounding box.
5. Write an overlay per layer, red for KiCad only and blue for pcbjs only, and look at every one.

## The y flip

gerber-to-svg wraps each file in `translate(0, 2*vb.y + vb.h) scale(1,-1)`, which flips it about the middle of its own extent. Two files whose ink spans different y ranges then compare shifted by half the difference: silk moves, copper with identical extents does not, so the bug hides on copper. Flip every file about y = 0 instead:

```js file=flip.mjs
export const inner = svg => svg
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>$/, '')
  .replace(/transform="translate\(0,[-\d.e]+\) scale\(1,-1\)"/, 'transform="scale(1,-1)"')
```

## Expected differences

| Layer | Usual cause | Acceptable |
| --- | --- | --- |
| copper in pours | reliefs drawn by each tool; pieces KiCad joins with 45 degree spokes that pcbjs removes as islands, fixed with `thermal: { angle: 45 }` | yes when no pad, track or via differs |
| copper on pads | polygon chords: pcbjs writes non-round pads as regions where KiCad flashes apertures | yes, a thin rim |
| silk | glyph shapes when the port draws Hershey; `font="newstroke"` with KiCad's size, width and thickness removes it | yes; or fix it |
| mask | an opening KiCad writes over NPTH pads, or a different `maskExpansion` | check the pad's mask margin |
| paste | windows on hand-solder lands, ratio margins | must match; it was wrong on early imports |
| Edge.Cuts, drills | none | must be identical, hole for hole |

pcbjs also writes files KiCad's set may not have: an IPC-D-356 netlist, drill maps, a drill report and a manifest. Count them, do not compare them.
