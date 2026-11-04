# qfn-breakout

## Learning goal

Break a QFN64 out to four headers, then compare automatic routing with the manual stubs and vias in tangled.tsx.

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/qfn-breakout
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

None.
