# eth-phy

## Learning goal

A gigabit PHY module, QFN48, magjack and two RGMII match groups of six lines tuned to 0.12 mm, four layers

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/eth-phy
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

One `silk-over-edge` warning: the RJ45 overhangs the board edge by design.
