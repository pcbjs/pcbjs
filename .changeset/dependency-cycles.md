---
'@pcbjs/compile': patch
'@pcbjs/cli': patch
---

Dependency cycles are compile errors: a strongly connected component or a self edge of the placement graph throws a `CycleError` whose `code` is `grid-cycle`, `follow-cycle`, `solver-order` or `reference-cycle`, naming each member by reference and source, and `check --json` reports it as a diagnostic of kind `cycle` with that code. A cycle of `reference()` entries names each entry with the call that leads on.
