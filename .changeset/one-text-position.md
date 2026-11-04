---
'@pcbjs/core': patch
'@pcbjs/lsp': patch
'@pcbjs/cli': patch
'@pcbjs/ts-plugin': patch
---

One text-position model: `textDoc(text)` in `@pcbjs/core/internal/textdoc` converts between offsets, zero-based LSP positions and one-based source sites, applies LSP edits and computes the one edit between two texts. The language server's document model, the session's edits, undo, events log and drafts, and the CLI's model writer all read it, the TypeScript plugin leaves its line map to TypeScript, so a site or a cursor maps to the same offset everywhere, and a position past a line's end lands at that line's end.
