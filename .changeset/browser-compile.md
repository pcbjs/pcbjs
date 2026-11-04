---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
---

The browser compile, docs/browser.md: `@pcbjs/compile/browser` runs the stage graph in a Web Worker on a memory platform with `want` and a cancel, streams the facets as they end and answers `compileInBrowser()`; `@pcbjs/export/browser-worker` is the worker. The worker carries V8's fdlibm Math as Node builds it, plain or with fused multiply-adds, so a board compiles to Node's bytes in Chromium, and checks a fixture's hash on load. `FacetOut` and `StageStatus` are in `@pcbjs/core/site-facets`.
