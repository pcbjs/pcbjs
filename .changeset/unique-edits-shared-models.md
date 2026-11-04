---
"@pcbjs/cli": patch
"@pcbjs/compile": patch
"@pcbjs/lsp": patch
"@pcbjs/ui": patch
---

Refuse expired edit transactions after project reloads, resolve shared-library model files against the project source root, and make nondefault variant targets explicitly read-only for source tools and cursor assist.

Recheck snapshots after asynchronous query settling so a watcher compile that finishes during the wait does not trigger a redundant second compile.
