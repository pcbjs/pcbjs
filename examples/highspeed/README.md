# highspeed

## Learning goal

A USB-C to header adapter with 90 ohm differential pairs, a via pair, ESD array and a length matched four line bus on four layers

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/highspeed
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

None.
