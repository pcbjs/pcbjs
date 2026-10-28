---
'@pcbjs/export': patch
---

`boardSvg(board, { vars: true })` writes every colour as a CSS variable with the default as its fallback, `--pcb-<layer>`, `--pcb-canvas` and `--pcb-substrate`, and draws the outline as a substrate, so a page can theme the board; the default output is unchanged.
