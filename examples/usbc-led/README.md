# usbc-led

A pcbjs board. The design is `pcb.tsx`, project settings are in `pcb.config.ts`.

```sh
npm install
npm run dev       # live viewer on http://localhost:5173, updates on every save
npm run build     # fab files in .pcbjs/fab/usbc-led, static site in .pcbjs/dist
npm run preview   # serve the built site
```

`npm run build` prints the DRC and ERC summary and fails when the board has errors or unconnected nets. The fab zip in `.pcbjs/fab/usbc-led` is what you upload to the fab.

To grow the board, add nets and parts at the top of `pcb.tsx` and place them below. When the schematic outgrows one file, move the nets and parts to `board.sch.ts` and the part numbers to `board.sourcing.ts`, and import them from `pcb.tsx`.

## Learning goal

The smallest review board: a 5 V USB-C sink, an LDO, two LEDs and a header

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/usbc-led
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

None: the USB-C receptacle's GND and VBUS pads, 0.15 mm apart, share a gang mask opening at each end.
