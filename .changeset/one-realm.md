---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/kicad': patch
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

A project's parts, default board, KiCad config, model resolver and source mapper live in one realm that a workspace or the browser compile swaps whole, so two projects in one process never see each other's. The compile takes the default layer as an option, `defaults`, the realm's when left out, and keys its cache on it, so a default one entry sets never serves another entry a stale board. Two copies of `@pcbjs/core` whose realms differ stop with an error naming both, and `pcbjs doctor` reports the realm abi. The editor's "Name this part" action takes the prefix and the refs in use from the compiled boards.
