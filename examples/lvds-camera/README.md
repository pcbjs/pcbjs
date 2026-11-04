# lvds-camera

## Learning goal

Five 100 ohm LVDS pairs with array ends, an I2C level shifter and two custom footprints on four layers

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/lvds-camera
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

None.
