# sensor-hat

A Raspberry Pi HAT in the official 65 x 56.5 mm outline: BME280, LIS3DH, an OLED header, micro SD, a LiPo charger on USB-C, the HAT ID EEPROM, a buzzer, two buttons and a WS2812B-2020. The schematic is `hat.sch.ts`, the footprints copied from KiCad are in `lib/footprints.tsx`, the layout is `pcb.tsx`, and every part outside the generated stdlib bodies has a STEP model in `models/`, whose sources are in `models/LICENSES.md`.

```sh
npm install
npm run dev       # live viewer on http://localhost:5173, updates on every save
npm run build     # fab files in .pcbjs/fab/sensor-hat, static site in .pcbjs/dist
npm run preview   # serve the built site
```

`npm run build` prints the DRC and ERC summary and fails when the board has errors or unconnected nets. The fab zip in `.pcbjs/fab/sensor-hat` is what you upload to the fab.

## Learning goal

A Raspberry Pi HAT in the official outline with 11 model files from KiCad and LCSC

## Run this example

From the repository root, run `npm install` and `npm run build` once. Then:

```sh
cd examples/sensor-hat
node ../../packages/pcbjs/bin/pcbjs.js check
node ../../packages/pcbjs/bin/pcbjs.js dev
```

Use the viewer to compare the source with the board, schematic and findings. `pcbjs build` writes the fabrication output when ready.

## Expected findings

None: the 0.5 mm pitch accelerometer has one gang mask opening per pad row.
