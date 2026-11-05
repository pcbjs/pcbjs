# Examples

Group layouts use a local origin near their visual centre. Place parts on either side of that origin, keep internal routes, vias and drawings in the same local frame, and put board offsets on the group's `at`. Blinky's row, Quad's divider, the library regulator and the motor-driver columns demonstrate this convention. Existing blocks centered on their main device keep that useful local origin.

For small reusable groups, keep `schematic` and one or more `layout` / `layoutVariant` exports in a single `.tsx` module. Use descriptive import aliases at board call sites and distinct explicit runtime names for layout variants. Split modules when size or ownership makes that clearer, not to satisfy source mapping.

Each folder is a pcbjs project; run `pcbjs check` in it. Every board is DRC and ERC clean unless its line names the finding it keeps and why.

## Learning paths

Folders keep stable import and source links. Choose a focused path, then read that project's README for its run commands and expected findings.

| Goal | Projects in suggested order |
| --- | --- |
| First board and split files | [demo](demo/README.md): Coin, Blinky, Quad, Multi |
| Routing and signal integrity | [qfn-breakout](qfn-breakout/README.md), [highspeed](highspeed/README.md), [usb-hub](usb-hub/README.md), [lvds-camera](lvds-camera/README.md), [eth-phy](eth-phy/README.md), [sdram](sdram/README.md), [usb3-hub](usb3-hub/README.md) |
| Reuse and multiple boards | [library](library/README.md), [motor-stack](motor-stack/README.md), [board-poses](board-poses/README.md) |
| Power and manufacturing | [usbc-led](usbc-led/README.md), [psu](psu/README.md), [sensor-hat](sensor-hat/README.md) |
| Repeated circuits and complete devices | [badge](badge/README.md), [led-matrix](led-matrix/README.md), [esp32-sensor](esp32-sensor/README.md), [stm32-dev](stm32-dev/README.md) |

## Basic

The three boards of the basic path, docs/basics.md: start with these.

| Board | What it shows | Known findings |
| --- | --- | --- |
| `demo/blinky.pcb.tsx` | Blinky: three LED channels switched by one transistor on two layers, split over schematic, sourcing and layout files | none, and it must stay clean |
| `demo/coin.pcb.tsx` | Coin: the smallest board, nets, parts and layout in one file: two test pads on the battery net of a 20 mm round board | none, and it must stay clean |
| `qfn-breakout/pcb.tsx` | a QFN64 broken out to four headers by 76 autorouted legs; `tangled.tsx` beside it turns every header end for end and routes with manual stubs and vias | none |

## Advanced

Everything else, by folder; docs/advanced.md has the topics they use.

| Folder | What it demonstrates | Known findings |
| --- | --- | --- |
| `demo` | Quad, four layers, and Multi, one design for three fab targets with `variants`, beside Blinky and Coin of the basic path | none, and they must stay clean |
| `highspeed` | a USB-C to header adapter with 90 ohm differential pairs, a via pair, ESD array and a length matched four line bus on four layers | none |
| `badge` | a round OSH Park badge: charlieplexed rim LEDs, curved text, silk logo, a lanyard slot, a pogo programming array and a coin cell on the back | none |
| `esp32-sensor` | an ESP32-C3 sensor node, 40 by 30 mm on two layers, built from the README and docs alone | none |
| `eth-phy` | a gigabit PHY module, QFN48, magjack and two RGMII match groups of six lines tuned to 0.12 mm, four layers | one `silk-over-edge` warning: the RJ45 overhangs the board edge by design |
| `led-matrix` | an N by N WS2812B-2020 matrix built from a circuit placed per pixel, serpentine data chain, pours on both sides | none |
| `lvds-camera` | five 100 ohm LVDS pairs with array ends, an I2C level shifter and two custom footprints on four layers | none |
| `library` | `power`, a library built with `pcbjs build --lib`: a regulator circuit, its layout and the PowerModule board; `consumer`, a carrier that places the circuit and references the board by package, the library installed by `scripts/check-examples.mjs` | none |
| `board-poses` | three upright camera references using translation and quaternion orientation, top-surface height conversion, automatic source updates and independent fabrication output | none |
| `motor-stack` | three boards in one folder, controller, driver and test jig, sharing `lib/`; the driver lays out a half bridge circuit three times | `driver` keeps the ERC warning `copper-weight`: 2 oz copper under the 1 oz preset rules, kept because the 0.16 mm rules reroute it into split pours |
| `psu` | a 24 V to 5 V 5 A buck, copper first: power pours, thermal maps, arcs in the outline and a cutout, 2 oz copper, vendor STEP models; the status LED group placed by the placer and the boot capacitor following the switch node | none: the regulator's SW, PGND and VIN bars take a 0.02 mm mask margin, inside TI's 0.05 maximum, to keep the 0.13 mm dam black mask needs |
| `sdram` | an STM32F429 with a 16-bit SDRAM on four layers: 91 autorouted legs and two match groups on a timing budget | one `length-match` error on DATA: the FMC data pins sit on the far sides of the MCU and the only free board lies behind ADDR, so closing it needs the SDRAM moved or the inner layers opened |
| `sensor-hat` | a Raspberry Pi HAT in the official outline with 11 model files from KiCad and LCSC | none: the 0.5 mm pitch accelerometer has one gang mask opening per pad row |
| `stm32-dev` | an STM32F103 board for JLCPCB and OSH Park four layers from one design | none |
| `usb-hub` | a four port USB 2.0 hub on two layers, every pair from an impedance class with array ends | none |
| `usb3-hub` | a four port USB 3.2 hub on the 3313 four layer preset: SuperSpeed pairs through AC capacitors and ESD arrays, match groups per port, 115 autorouted legs | none |
| `usbc-led` | the smallest review board: a 5 V USB-C sink, an LDO, two LEDs and a header | none: the USB-C receptacle's GND and VBUS pads, 0.15 mm apart, share a gang mask opening at each end |
