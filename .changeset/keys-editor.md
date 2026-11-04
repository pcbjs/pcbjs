---
'@pcbjs/ui': patch
'@pcbjs/vscode': patch
---

The key map table carries the extension's keys under an Editor scope, and the extension's `keybindings` are generated from it, so VS Code and the viewer never disagree; the `?` overlay lists them and the palette, which runs only view commands, leaves them out.
