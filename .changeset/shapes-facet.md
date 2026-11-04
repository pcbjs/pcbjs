---
'@pcbjs/core': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
'@pcbjs/lsp': patch
---

The board data splits its items in two: `items` in the `layers` facet are rows with no geometry, each with its id, uid, kind, layers, net, ref, pad number, box, drill, route, pair, role and width, and a new `shapes` facet holds every item's rings, the parts of outer copper under the mask and each side's mask openings, packed flat by item id and read with `@pcbjs/core/site-shapes`. A footprint's pads carry their item's `uid`. The 2D view takes `layers` without the copper's rings, and `shapes` only while the assist is on; the 3D view takes both and remakes its scene only when the shapes, the parts or their models change, never for new findings or a new fab set. No view reads pad numbers, refs or mask openings out of the layer markup any more.
