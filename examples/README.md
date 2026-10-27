# Examples

Each folder is a pcbjs project; run `pcbjs check` in it. Every board is DRC and ERC clean unless its line names the finding it keeps and why.

| Folder | What it demonstrates | Known findings |
| --- | --- | --- |
| `demo` | the four demo boards: Blinky, three LED channels split over schematic, sourcing and layout files; Coin, the smallest board; Quad, four layers; Multi, one design for three fab targets with `variants` | none, and they must stay clean |
| `highspeed` | a USB-C to header adapter with 90 ohm differential pairs, a via pair, ESD array and a length matched four line bus on four layers | none |
| `badge` | a round OSH Park badge: charlieplexed rim LEDs, curved text, silk logo, a lanyard slot, a pogo programming array and a coin cell on the back | none |
| `esp32-sensor` | an ESP32-C3 sensor node, 40 by 30 mm on two layers, built from the README and docs alone | none |
| `eth-phy` | a gigabit PHY module, QFN48, magjack and two RGMII match groups of six lines tuned to 0.12 mm, four layers | one `silk-over-edge` warning: the RJ45 overhangs the board edge by design |
| `led-matrix` | an N by N WS2812B-2020 matrix built from a circuit placed per pixel, serpentine data chain, pours on both sides | none |
| `lvds-camera` | five 100 ohm LVDS pairs with array ends, an I2C level shifter and two custom footprints on four layers | none |
| `motor-stack` | three boards in one folder, controller, driver and test jig, sharing `lib/`; the driver lays out a half bridge circuit three times | `driver` keeps the ERC warning `copper-weight`: 2 oz copper under the 1 oz preset rules, kept because the 0.16 mm rules reroute it into split pours |
| `psu` | a 24 V to 5 V 5 A buck, copper first: power pours, thermal maps, arcs in the outline and a cutout, 2 oz copper, vendor STEP models | none: the regulator's SW, PGND and VIN bars take a 0.02 mm mask margin, inside TI's 0.05 maximum, to keep the 0.13 mm dam black mask needs |
| `qfn-breakout` | a QFN64 broken out to four headers by 76 autorouted legs; `tangled.tsx` turns every header end for end and routes with manual stubs and vias | none |
| `sdram` | an STM32F429 with a 16-bit SDRAM on four layers: 91 autorouted legs and two match groups on a timing budget | one `length-match` error on DATA: the FMC data pins sit on the far sides of the MCU and the only free board lies behind ADDR, so closing it needs the SDRAM moved or the inner layers opened |
| `sensor-hat` | a Raspberry Pi HAT in the official outline with 11 model files from KiCad and LCSC | none: the 0.5 mm pitch accelerometer has one gang mask opening per pad row |
| `stm32-dev` | an STM32F103 board for JLCPCB and OSH Park four layers from one design | none |
| `usb-hub` | a four port USB 2.0 hub on two layers, every pair from an impedance class with array ends | none |
| `usb3-hub` | a four port USB 3.2 hub on the 3313 four layer preset: SuperSpeed pairs through AC capacitors and ESD arrays, match groups per port, 115 autorouted legs | none |
| `usbc-led` | the smallest review board: a 5 V USB-C sink, an LDO, two LEDs and a header | none: the USB-C receptacle's GND and VBUS pads, 0.15 mm apart, share a gang mask opening at each end |
