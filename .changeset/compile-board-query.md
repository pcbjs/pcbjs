---
'@pcbjs/compile': patch
---

`@pcbjs/compile/query` is a read-only board API over one compiled board: parts, nets, routes, findings and items as frozen views whose `toJSON` is their record, `resolve` of any reference, `distance` edge to edge, `clearance` with the level it came from, `items.near` and `items.on` over a lazy spatial index, `bbox`, `source` and `rulesAt`.
