---
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

Serve STEP meshes from each live session project's compiled boards, including isolated previews. Keep assist contexts, completion focus, grid highlights and viewer hover inside their originating project when board names match across a workspace, and clear tool state when files close or projects reload. Language server host assist contexts and completion metadata carry their project root, and the grid event now receives the project root before its board and grid names.
