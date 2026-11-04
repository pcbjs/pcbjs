---
'@pcbjs/cli': patch
---

`session/select` with a board reference alone, `board:<name>`, keeps the board's selection and opens its entry in every editor with the cursor on its `<PCB`, focused with `focus: true`; a viewer may send `session/select` through `pcbjs:edit`.
