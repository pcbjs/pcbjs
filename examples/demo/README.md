# demo

## Learning goal

Learn nets and placement with Coin, split schematic and layout with Blinky, four layers with Quad, and fab variants with Multi.

Small reusable groups stay in one file: `lib/led-channel.tsx` exports `schematic`, the default `layout`, and `layoutStack`. Board files import these with descriptive aliases. The schematic definition and each layout remain separate declarations for source focus.

Blinky centres each reusable LED row between its resistor and LED; Quad centres its divider between R1 and R2. Their group placements carry the board offsets, so rotating either group turns around the local layout rather than the board origin.

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/demo
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

None; these four boards must remain clean.
