---
"@pcbjs/cli": patch
---

`pcbjs create` takes `--layers`, `--fab`, `--size` and `--outline` to pick the fab preset and draw the outline, with the template's circuit in the middle, and `--example <name>` to copy one of six example boards: blinky, coin, quad, multi, led-matrix and qfn-breakout. `pcbjs create --list-examples` prints them with a line each. Without the new flags `pcbjs create` gives the same board as before.
