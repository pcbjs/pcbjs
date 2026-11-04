---
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
'@pcbjs/vscode': patch
---

The IDE protocol declares `protocol`, `major` and `capabilities` in `hello`, `ready` and `initializationOptions.pcbjs`, and every segment carries its `widget`. The editor's cursor, focus and selection travel through the language server. `dev.json` holds `pid`, `version`, `protocol`, `major`, `startedAt`, `root` and `url`. A Boards view row runs `pcbjs.open2D`, `pcbjs.open3D` and `pcbjs.openSchematic`, Alt for another pane.
