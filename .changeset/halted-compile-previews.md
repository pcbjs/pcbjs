---
"@pcbjs/core": patch
"@pcbjs/compile": patch
"@pcbjs/cli": patch
"@pcbjs/ui": patch
---

Recover preview-only geometry before a failing source expression and show a static progress bar with the failed stage in red. Mark DRC/ERC incomplete, reject partial artifact exports, and require a full successful recompile to clear the halted state. Preserve exact source ranges for synchronous JSX expression failures.
