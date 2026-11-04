---
'@pcbjs/vscode': patch
---

The sidebar's Findings, Nets, BOM and parts read each board's facets through `session/facets` instead of `board.json` over HTTP, and reload them when the session's `session/state` reports a facet hash they do not hold.
