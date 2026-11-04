# psu

## Learning goal

A 24 V to 5 V 5 A buck, copper first: power pours, thermal maps, arcs in the outline and a cutout, 2 oz copper, vendor STEP models; the status LED group placed by the placer and the boot capacitor following the switch node

The status group's placement carries its board offset. Its LED and resistor use symmetric local placement seeds around the group origin, demonstrating the same convention with automatic placement.

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/psu
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

None: the regulator's SW, PGND and VIN bars take a 0.02 mm mask margin, inside TI's 0.05 maximum, to keep the 0.13 mm dam black mask needs.
