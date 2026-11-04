---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/step': patch
'@pcbjs/ui': patch
'@pcbjs/lsp': patch
'@pcbjs/vscode': patch
---

Every source position in the board data is one `SiteSrc`, a file relative to the project root with its line, column and range when it has one; a footprint's `src` and `def` no longer carry an absolute path, and the language server and the editor resolve the file against the root. A referenced board's parts are its footprints' own fields, and its slotted drills keep their length and axis, turned onto this board, so a referenced slot is drawn as a slot rather than a round hole. `StepTransform` is declared once, in `@pcbjs/core/site-data`, and `@pcbjs/step` takes it from there.
