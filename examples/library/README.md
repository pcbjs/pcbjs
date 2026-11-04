# library

## Learning goal

`power`, a library built with `pcbjs build --lib`: a regulator circuit, its layout and the PowerModule board; `consumer`, a carrier that places the circuit and references the board by package, the library installed by `scripts/check-examples.mjs`

The regulator layout's origin sits between the regulator and its capacitors. Both the module board and consumer supply their own placement offsets; the reusable layout contains no board coordinates.

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/library
cd power
node ../../../packages/pcbjs/bin/pcbjs.js check
node ../../../packages/pcbjs/bin/pcbjs.js build --lib
```

Run `node scripts/check-examples.mjs` from the repository root to install the built library into `consumer` and check both projects.

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

None.
