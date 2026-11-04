---
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

Fix Windows file identity across editor paths, Vite modules and TypeScript diagnostics. Saved imports and configuration changes now reach their projects, source navigation accepts matching allowed paths, and unsaved editor buffers retain ownership across drive-letter case differences. Discard type-check caches written by the old path filter so a cached success cannot hide errors.

Based on the Windows reproductions and patch documented in [importly/vfdclock-pcb](https://github.com/importly/vfdclock-pcb/tree/87fda6ec48d3f9e4988a891dccc1f32da617d027/patches).
