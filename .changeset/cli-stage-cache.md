---
'@pcbjs/cli': patch
'@pcbjs/skills': patch
---

`pcbjs check`, `build`, `inspect` and `dev` serve a board whose files are unchanged from `.pcbjs/cache` without evaluating it. `check --cache` prints each stage as a hit or a miss with its key, `check --verbose` shows the hits, and `--fresh` on `check`, `build`, `inspect` and `shot` rebuilds every stage, `--fresh=all` rerouting too. Vite's cache is `.pcbjs/cache/vite` and referenced boards `.pcbjs/cache/references`.
