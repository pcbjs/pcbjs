# Comparing against the original

A board ported from another tool keeps a comparison with the original while it is improved: every pad on the same net, every track and via where it was, except the differences made on purpose. The pcbjs-port-from-kicad skill has the comparison scripts; this page is how to keep them useful once the board starts to change.

## Intended differences

A comparison that fails on any copper difference stops being run the day the first improvement lands. Keep a list of the differences you made, each keyed the way the comparison prints it and with its reason, and let the comparison subtract them:

```js file=expected.mjs
export default {
  Base: {
    nets: ['DRAIN'],
    addedVias: {
      'DRAIN|40.100,29.300|0.620|0.300': 'thermal via at the FET drain',
      'DRAIN|40.900,29.300|0.620|0.300': 'thermal via at the FET drain',
    },
    removedSegments: {},
    stitch: { net: 'GND', count: 28 },
  },
}
```

- The comparison fails on any difference not listed, and on a listed key it no longer finds, so the list cannot go stale.
- `nets` names nets to query that the original routes only by pour: without it a via added on such a net is never seen.
- Stitching vias from `stitch()` are counted per net from the `stitch` line of `inspect <net>`, not matched one by one.

## What to compare, in order

1. Pads: every pad's net, centre and size by ref and pad number. Net names may differ between tools, so check that each original net maps to exactly one pcbjs net and back, not that the names are equal.
2. Copper: every track segment by net, layer, width and both ends; arcs by ends and centre; every via by centre, size and drill.
3. Gerbers, per layer: area only in one set, area left after a one pixel erosion, ink bounding box. Look at the overlay image; the numbers alone have hidden a shifted layer.

## Reporting

Write one table per check with the result per board, then each remaining difference with its cause and whether it is acceptable. Typical acceptable causes: pour reliefs drawn by each tool, polygon chords on curved pads, stroke font glyphs, a mask opening the fab drills through anyway.
