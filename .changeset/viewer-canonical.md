---
'@pcbjs/viewer': patch
'@pcbjs/cli': patch
---

The viewer URL flags `ide`, `embed`, `panel` and `tools` take `1` and `0`, and `theme` takes `light`, `dark` or `hc`. The viewer reads board data with `schematic`, `erc` and `sourcing` as the build writes them. Every viewer says `pcbjs:viewer:hello` with its board, and the dev server answers board files under `/__pcbjs/<name>/` only.
