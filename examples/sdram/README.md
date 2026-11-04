# sdram

## Learning goal

An STM32F429 with a 16-bit SDRAM on four layers: 91 autorouted legs and two match groups on a timing budget

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/sdram
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

One `length-match` error on DATA: the FMC data pins sit on the far sides of the MCU and the only free board lies behind ADDR, so closing it needs the SDRAM moved or the inner layers opened.
