---
'@pcbjs/compile': patch
'@pcbjs/cli': patch
---

The stage cache keys hold `@pcbjs/core` as well as `@pcbjs/compile`: `compileId` is a digest over both package ids, and the export formats key on `@pcbjs/export` and `@pcbjs/core`, so a change to core alone recomputes fills, findings, silk refs and exports instead of serving them from the cache. The route memos stay warm.
