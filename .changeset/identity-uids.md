---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/ui': patch
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

An item's uid names who made it: its kind, the route that laid its copper, the part that owns it or the call that drew it, and its ordinal there, so a moved, turned or flipped part or text keeps its uids and its selection; `itemRev` in `@pcbjs/core/ref` gives what an item is now, and the site's item rows carry it as `rev`. Only uids cross between facets: source ranges list `uids` and `outer` uids, findings in the site name their items by uid, and schematic pins and symbols name their pads by uid. References resolve through one `resolveRef` over a `RefIndex`, which `boardIndex` builds of a compiled board and `siteIndex` of a board's joined facets, with `refNet`, `refRoute` and `isTreeRef` reading a reference's form.
