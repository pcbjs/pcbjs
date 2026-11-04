---
'@pcbjs/core': patch
'@pcbjs/lib': patch
'@pcbjs/fab': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/kicad': patch
'@pcbjs/lsp': patch
'@pcbjs/step': patch
'@pcbjs/cli': patch
'@pcbjs/skills': patch
'@pcbjs/viewer': patch
---

Each package lists its entries by name. The public entries: `@pcbjs/core` with `jsx-runtime`, `jsx-dev-runtime`, `model`, `ref`, `finding`, `site-data`, `site-facets` and `platform`; `@pcbjs/lib` with `rules`, `stackups` and `impedance`; `@pcbjs/fab` with each preset such as `JLCPCB/2-Layer`; `@pcbjs/compile` with `query` and `browser`; `@pcbjs/export` with `compose` and `browser-worker`; `@pcbjs/step` with `binary`; `@pcbjs/ui` with `style.css`; `@pcbjs/cli` with `vite`, `client`, `test` and `test-register`; `@pcbjs/kicad`, `@pcbjs/lsp` and `@pcbjs/skills` with their root only. The modules the packages import from each other are `./internal/<module>` entries, listed one by one, for packages of the same train only.
