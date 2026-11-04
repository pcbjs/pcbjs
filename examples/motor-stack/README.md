# motor-stack

## Learning goal

Three boards in one folder, controller, driver and test jig, sharing `lib/`; the driver lays out a half bridge circuit three times

Each half-bridge column uses a local origin near its visual centre. Parts, pours, vias, keepouts and route waypoints share that frame; the three placements carry the column positions on the driver board.

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/motor-stack
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

`driver` keeps the ERC warning `copper-weight`: 2 oz copper under the 1 oz preset rules, kept because the 0.16 mm rules reroute it into split pours.
