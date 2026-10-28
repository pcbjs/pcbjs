---
"@pcbjs/vscode": patch
---

Three commands start a project from VS Code: `pcbjs: Create project in workspace` runs `pcbjs create` and opens the new `pcb.tsx` with its preview, `pcbjs: Convert from KiCad` finds the workspace's `.kicad_pro` files, converts one with its `.kicad_pcb` beside it through `pcbjs import board` into a folder you confirm and opens it, and `pcbjs: Install skills` runs `pcbjs skills install` in a project, offering `npx @pcbjs/skills install` when `@pcbjs/skills` does not resolve. The Boards view shows all three in a workspace without a pcbjs project.
