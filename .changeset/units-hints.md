---
'@pcbjs/lsp': patch
'@pcbjs/vscode': patch
'@pcbjs/cli': patch
'@pcbjs/viewer': patch
---

Units in the editor: each bare number of a length, position or rotation has its unit as an inlay hint, `9mm`, `90deg`; a part's position under a grid has the grid's glyph and pitch, `3·⊞2.54mm`, whose tooltip names the grid and whose cmd+click goes to its `defineGrid`, and hovering the number lights the grid in the previews for 3 s. The numbers, units and layers inside coordinate strings are semantic tokens for Neovim, Zed and Helix, and `pcbjs/tokens` for a client with the `tokens` capability, which the VS Code extension draws as decorations in the colours `pcbjs.unitNumber`, `pcbjs.unitUnit` and `pcbjs.unitLayer`. An unknown unit is an error at its token. In an editor pane, cmd or ctrl+Z undoes the last tool write in its file.
