---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
'@pcbjs/lsp': patch
---

Support boolean locked attributes on PCB and schematic part placements. Bare locked means true, while expressions are evaluated on each compile. Carry independent lock flags through viewer metadata, show a selection badge, and refuse preview edits to locked placements or groups containing them. Recheck locks before writing and cancel active drags when targets become locked. Schematic part declarations without at retain automatic placement.

Add a toolbar lock toggle for bare attributes, backed by source-aware checks and the existing undo/redo transactions. Expression-based lock states disable the control with an explanatory tooltip and cannot be overwritten by a stale client.
