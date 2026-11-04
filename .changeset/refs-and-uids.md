---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
---

The reference grammar and item uids. `@pcbjs/core/ref` parses, prints and resolves references: tree paths such as `CH2/R01/2`, a pad by number then pin name, and the typed segments `board:`, `net:`, `route:` with `leg:` and `pt:`, `pair:`, `item:`, `drc:`, `erc:`, `span:`, `plane:` with `region:` and `panel:`. Every item gets a `uid` beside its `id`, `item:` and 12 hex over its kind, layers, net, the text of its source range and its geometry, given when the stage that adds it ends, so a line inserted above keeps it; the source-range transform adds the text `hash` to each range, route records carry their `pts` and `legs`, and site items their `uid`. Plugin deltas name items by uid and `ctx.resolve` takes any reference.
