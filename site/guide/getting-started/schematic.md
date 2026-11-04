---
title: Define the schematic
description: Use nets and part connections to describe what Blinky does before placing copper.
---

# Define the schematic

Open `blinky.sch.tsx` in the project from either setup page. A schematic describes which pins connect. The board layout will decide where those pins sit and how copper joins them.

## Read one connection

Blinky names four board-level nets: `GND`, `VCC`, `SIG` and `SW`. Its header makes their entry points explicit:

Find J1’s declaration in the complete file below. `PinHeader(3)` chooses a three-pin footprint factory; calling it creates the part. `.connect()` assigns each pin a net. A net is a value returned by `nets()`, so pass `VCC`, rather than the string `'VCC'`.

The constant name `J1` becomes the part reference in the viewer, silk and BOM. Pin handles such as `J1[3]` let routes and schematic wires name the same pin later.

## Follow the circuit

Signal `SIG` reaches Q1's pin 1. Q1's pin 2 connects to ground, and pin 3 is on `SW`. Each LED channel runs from `VCC`, through a resistor and LED, to `SW`. Q1 switches that common return.

This first lesson inspects the schematic of the supplied working layout. The other source tabs include its actual placements, so the preview has no hidden setup. The next lesson starts a fresh outline and adds placements progressively.

<GuideDemo example="blinky-schematic" />

The three instances `CH1`, `CH2` and `CH3` reuse `lib/led-channel.tsx`. Each has its own resistor, LED and private net between them. The shared `VCC` and `SW` connections are its ports. You can use this circuit without learning how to author a reusable circuit yet.

## Connections and drawing are separate

The exported `drawing` uses `<Schematic>` to position symbols and `wire()` to draw their links. Those positions are sheet coordinates, with a default grid of 2.54 mm, not the board's millimetre positions. A part inside `<Schematic>` draws its symbol; the same part on a board draws its footprint.

Changing a symbol's position rearranges the picture. Change `.connect()` when the electrical connection itself must change. Manufacturer part numbers live in `blinky.sourcing.ts`, imported by the board, so they do not obscure this circuit description.

**Try it:** find C1 and read its two connections. It sits across `VCC` and `GND`. Locate those nets in the schematic view before moving anything.

Next: [Define the board](./board). For the complete API, see [Schematic reference](/docs/schematic).
