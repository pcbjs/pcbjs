# Standard library

Every footprint family in `@pcbjs/lib` with its pins, prefix and frame, the helpers for writing footprints, and the value, font and shape utilities.
Import from `@pcbjs/lib`, or from one module such as `@pcbjs/lib/ic`.

Every footprint is dual-mode: `R0603('330')` makes a part, `<R0603 ref="R1" at="5 5" />` renders, see schematic.md. Ids use the `pcbjs:` prefix and follow KiCad names. Frames are mm, y down, origin at the body centre unless a family says otherwise. Land patterns follow the KiCad 9 library, and a test places every footprint on an empty board of every fab preset with no finding.

A positive rotation turns a part counter-clockwise on screen, and `side="B"` mirrors it first: a `PinHeader(2)` at `at="10 10 90deg"` has pin 1 at (10, 10) and pin 2 at (12.54, 10), its +y row turned to +x. `pcbjs inspect` prints where every pad landed.

Generators throw a TypeError naming a bad parameter and the form it takes.

## Renaming pins

Every generated footprint takes `pinNames`, and `withPins` renames a copy:

```ts
import { SOT23, withPins, Crystal3225, SOT223 } from '@pcbjs/lib'

const LDO = SOT23(5, { pinNames: ['VIN', 'GND', 'EN', 'NC', 'VOUT'] })   // a list renames the pins in order
const Y = withPins(Crystal3225, { 2: 'GND1', 4: 'GND2' })                   // a record maps pad numbers or pin names
const REG = withPins(SOT223, ['GND', 'VOUT', 'VIN'])
// LDO('AP2112K-3.3').connect({ VIN, GND, EN: VIN, VOUT: V3 })
```

- Pads given the same name share one pin. A rename can also split a shared pin.
- A pad named `NC` is no pin and goes in the footprint's `nc` list, so it needs no connection.
- `prefix` and `value` change the ref prefix and the default value.
- The same arguments give the same factory, so `source(SOT23(5), …)` finds parts made elsewhere.

## Passives, `@pcbjs/lib/passives`

| Factory | Pins | Prefix |
| --- | --- | --- |
| `R0402`, `R0603`, `R0805`, `R1206` | `1`, `2` | R |
| `C0402`, `C0603`, `C0805`, `C1206` | `1`, `2` | C |
| `LED0603`, `LED0805`, `LED1206` | `K` pad 1 with the silk bar, `A` pad 2 | D |
| `LED(size, color?)` | `K`, `A` | D |
| `chip(prefix, size, { names?, polarity?, color? })` | `1`, `2` or the two `names` | the prefix, D for LED |

Pad 1 is at -x. `chip` prefixes are `R`, `C`, `LED`, `L` and `D`; sizes `0402`, `0603`, `0805` and `1206`. Named pins stay reachable by number.

## Headers and connectors

The headers and connectors take one form: the call makes a part, and its last argument is the value or an options object.

```ts
import { PinHeader, PinSocket, JST_PH, JST_XH, USBC } from '@pcbjs/lib'

const J1 = PinSocket(20, { rows: 2, value: 'GPIO 2x20', source: { MPN: 'SSQ-120-03-T-D' } })   // pins 1 to 40
const J2 = PinHeader(4, 'PZ254V-11-04P')
const J3 = JST_PH(6, 'side', { drill: 0.8 })
const J4 = JST_XH(4, { value: 'B4B-XH-A', pinNames: ['V5', 'GND', 'CANH', 'CANL'] })
const J5 = USBC('power6', { source: { MPN: 'TYPE-C-31-M-17' } })
// J4.connect({ V5, GND, CANH, CANL })
```

| Call | Pins | Prefix | Frame |
| --- | --- | --- | --- |
| `PinHeader(pins, { pitch = 2.54, rows = 1, drill, pad })` | `1` to `pins × rows` | J | pin 1 square at the origin, pins along +y, rows along +x |
| `PinSocket(pins, { rows = 1, drill, pad })` | `1` to `pins × rows` | J | as PinHeader |
| `JST_PH(pins, 'top' \| 'side', { drill, pad, silk })` | `1` to n | J | 2.0 mm, centred, pin 1 at -x |
| `JST_XH(pins, { drill, pad })` | `1` to n | J | 2.5 mm, centred, pin 1 at -x |
| `USBC('full16')` | `GND`, `VBUS`, `CC1`, `CC2`, `DP`, `DN`, `SBU1`, `SBU2`, `SHIELD` | J | HRO TYPE-C-31-M-12; signal pads at -y, the mouth at +y |
| `USBC('power6')` | `GND`, `VBUS`, `CC1`, `CC2`, `SHIELD` | J | HRO TYPE-C-31-M-17 |

- `pins` counts one row. A 2 x 20 socket is `PinSocket(20, { rows: 2 })` with pins 1 to 40.
- The options take the family's own, `pinNames`, `prefix`, `silk` and the part options such as `value`, `source` and `model`. `JST_PH` defaults to `'top'`, `USBC` to `'full16'`.
- `.footprint(...)` with the same arguments is the footprint factory: `JST_XH.footprint(4)('B4B-XH-A')` makes a part, and `withPins` and `source(factory, value, spec)` take it.
- `drill` is the drill in mm and `pad` the copper, a diameter or `[w, h]` in footprint axes. Defaults follow the datasheets as KiCad 9 does: JST PH 0.75 mm in 1.2 x 1.75 mm, JST XH 0.95 mm in 1.7 x 1.95 mm, 2.54 mm headers and sockets 1.0 mm in 1.7 mm. A changed drill or pad adds `_Drill0.8mm` or `_Pad1.8x2.1mm` to the footprint id. For any other change, write the footprint with `defineFootprint`.
- `silk` is `'full'`, `'open'` or `'none'` on every generated family and `PinHeader`. `'open'`, the default of `JST_PH(n, 'side')` and `USBC`, leaves the mating side out, so a part flush with the edge draws no `silk-over-edge`; without a mating side it is `'full'`. A mode other than the default adds `_SilkFull` or `_NoSilkScreen` to the id. `kicadFootprint('Lib:Name', { silk })` of `@pcbjs/kicad` takes it too.
- A 2-row header numbers across the row: pins 1 and 2 side by side, then 3 and 4, so the odd pins form the first row. At 1.27 mm pitch the pads are 1.0 mm on a 0.6 mm drill, a 0.2 mm ring, where KiCad's 0.65 mm drill falls under JLCPCB's 0.18 mm.
- USB-C: the A and B contacts of DP and DN are joined as one pin each. A route to `J1.VBUS` ends at its nearest pad, or name one, `J1['B4']`. Connect unused `SBU1` and `SBU2` to `NC`. Let the mouth overhang the board edge.

## Test points and holes

| Factory | Pins | Prefix | Notes |
| --- | --- | --- | --- |
| `TestPad(d = 1.5)` | `1` | TP | round SMD pad on F.Cu, out of BOM and placement |
| `PogoPad(d = 1.5, { cols, rows, pitch = 2.54 })` | `1` to n, down each column | TP, or J for a grid | bare pads for a pogo fixture |
| `MountingHole(d = 3.2, pad?)` | none, or `1` with a pad | H | NPTH; `pad` true or a diameter adds a plated ring |

A mounting hole without a pad has no pins, so it is not a part: place it as a plain footprint, `const Hole = MountingHole(3.2)` and `<Hole ref="H1" at="3.5 3.5" />`. With a pad it is a part with pin `1`, for GND.

## ICs, `@pcbjs/lib/ic`

| Factory | Pins | Prefix | Numbering |
| --- | --- | --- | --- |
| `SOT23(3)` | `1`, `2`, `3` | Q | 1 and 2 down the left, 3 on the right |
| `SOT23(5)`, `SOT23(6)` | `1` to n | U | 1 to 3 down the left, the rest up the right |
| `SOT223` | `1`, `2`, `3` | U | the tab, pad 4, is pin 2 |
| `SOIC(pins, 'N' \| 'W')` | `1` to n | U | 1.27 mm; down the left from pin 1, up the right |
| `TSSOP(pins)` | `1` to n | U | 0.65 mm, as SOIC |
| `QFN(pins, size, pitch, ep?, { pad?, vias?, height? })` | `1` to n, `EP` | U | counter-clockwise from pin 1 at the top of the left side |
| `LQFP(pins, size, pitch, { ep?, vias? })` | `1` to n, `EP` with `ep` | U | as QFN |

- The exposed pad is pad number pins + 1, pin `EP`. Rename it with `{ pinNames: { EP: 'GND' } }`.
- `vias: n` adds an n × n grid of thermal vias, 0.3 mm drill at 1 mm pitch, in the exposed pad.

## Power, switches, LEDs, crystals, modules

| Factory | Pins | Prefix | Notes |
| --- | --- | --- | --- |
| `CR2032Holder` | `+` on two tabs, `-` the centre contact | BT | Keystone 3034; keep F.Cu clear under the cell |
| `BatteryPads({ pitch, dia, drill })` | `+`, `-` | BT | wire pads, `drill: 0` for SMD tabs; out of BOM |
| `TactSwitch(size)` | `A` pads 1 and 2, `B` pads 3 and 4 | SW | sizes `6x6`, `5.1x5.1`, `4.5x4.5`, `4.2x3.2`, and `3x4` with two pads |
| `SlideSwitch()` | `1`, `2` common, `3` | SW | C&K JS102011SAQN |
| `WS2812B('5050' \| '2020')` | `DIN`, `DOUT`, `VDD`, `GND` | D | pad numbers differ per size; use the names |
| `Crystal3225` | `X1`, `GND` on two pads, `X2` | Y | `withPins` splits the lid pads |
| `Crystal2012`, `Crystal3215`, `Crystal5032`, `Crystal49S` | `1`, `2` | Y | |
| `ESP32C3Mini1` | `GND`, `3V3`, `EN`, `IO0` to `IO10`, `IO18`, `IO19`, `RXD0`, `TXD0` | U | 14 NC pads in `nc`; antenna at -y |

`ESP32C3Mini1Footprint({ antennaKeepout })` makes the module with or without the hard keepout under its antenna, on every copper layer. Place the antenna end at or past the board edge.

## 3D models

Every footprint has a body, generated or fetched on first use, see 3d.md.

| Family | Model |
| --- | --- |
| passives, LEDs, `PinHeader`, `SOT23`, `SOT223`, `SOIC`, `TSSOP`, `QFN`, `LQFP`, `WS2812B` | generated |
| `PinSocket`, `JST_PH`, `JST_XH`, `Crystal3225`, `Crystal3215`, `Crystal5032`, `Crystal49S`, `CR2032Holder`, `TactSwitch` 6x6, 4.5x4.5, 4.2x3.2 and 3x4 | KiCad 3D library |
| `TactSwitch` 5.1x5.1, `SlideSwitch`, `Crystal2012`, `USBC` | LCSC C318884, C221660, C97603, C165948, C283540 |
| `ESP32C3Mini1` | Espressif's KiCad library |
| `TestPad`, `PogoPad`, `MountingHole`, `BatteryPads` | none |

A part's `model` option, or the `model` prop where it is placed, replaces it with a STEP, glTF or WRL file, the library's body the fallback:

```ts
import { R0603 } from '@pcbjs/lib'

const R1 = R0603({ value: '330', model: { file: './models/R_0603_1608Metric.step', rotate: [0, 0, 180] } })
```

- The path is relative to the file holding the literal, as an import is; `offset`, `rotate` and `scale` follow KiCad. Passives, `PinHeader` and `PinSocket` share KiCad's origin; JST, centred, takes an `offset`.
- `pcbjs model add <file> --ref J1` fits a vendor file, see models.md; `withGenerated(model, props)` in `@pcbjs/lib/footprint` keeps a fallback for your own footprint.

## Writing footprints, `@pcbjs/lib/footprint`

```text
smd(num, x, y, w, h, extra?)                 // roundrect SMD pad centred at x y
tht(num, x, y, dia, drill, extra?)           // round through-hole pad
npth(x, y, drill)                            // non-plated hole
courtyard(w, h, cx = 0, cy = 0, side = 'F.CrtYd')   // rectangle centred at cx cy
silkRect(w, h, width = 0.15)                 // silk rectangle centred on the origin
padRow(n, pitch, { size, at?, axis?, drill?, first?, reverse?, names?, shape?, firstShape? })
padGrid(cols, rows, pitch, { size, at?, rowPitch?, order?, drill?, first?, names?, shape?, firstShape? })
silkOutline(w, h, { cx?, cy?, pads?, clearance?, width?, offset?, layer?, edges? })
```

- `padRow` centres n pads on `at` along `axis`, numbered from `first`, 1 by default. `padGrid` numbers row by row, or column by column with `order: 'columns'`. Both return pad elements; `padRowDefs` and `padGridDefs` return the same as data.
- `silkOutline` draws a body outline broken wherever it would come within `clearance` of a pad in `pads`, so the fab never clips it. A pad there is geometry only, `{ x, y, w, h }` by centre and size, and a `PadDef` works too. `edges` picks the sides to draw from `top`, `bottom`, `left` and `right`.
- A footprint written by hand is a function returning `<footprint>`, wrapped in `defineFootprint`, see schematic.md. `examples/demo/lib/MyPart.tsx` is a SOT-23 written that way.

## Brand

`<Brand>` draws the pcbjs mark and wordmark in silk, `js` as an outline, from `site/brand/wordmark-mono.svg`.

```tsx
<Brand at="24 17" height={5} />
<Brand at="6 6 90" height={4} only="mark" layer="B.SilkS" />
```

- `height` = 5 is the ink height in mm; `at` is its centre, `rot` turns it, `layer` = "F.SilkS", and a `B.` layer reads from below. It is 3.2 times as wide as high; `only="mark"` or `"wordmark"` draws one half.
- Below `silkMinWidth` × 26.25 high, 3.94 mm at 0.15, the `js` outline would be too thin: a compile error names the minimum, `brandMinHeight(silkMinWidth, only?)`. The mark alone goes to 2.1 mm.

## Values, `@pcbjs/lib/values`

- `parseOhms('4k7')` is 4700; `330`, `4.7k`, `10R`, `0R`, `R47`, `1M` and `47Ω` work. `parseFarads('100n')` is 1e-7. Both return null for text that is not a value.
- `formatValue(4700, 'Ω')` is `4.7 kΩ`. `eia96(ohms)` is the EIA-96 code or null.
- `resistorCode(ohms, size, tolerance?)` is the code printed on a chip resistor, which the 3D view shows.

## Fonts and shapes

- `strokeText(text, { size, thickness, anchor, width?, lineHeight?, letterSpacing? })` from `@pcbjs/lib/fonts` returns `{ strokes, width, height, missing }`, the polylines `<text>` draws. See fonts.md.
- `rect`, `roundedRect`, `circle` and `slot` from `@pcbjs/lib/shapes` return path data, see layout.md.
- `@pcbjs/lib/rules` and `@pcbjs/lib/stackups` are in rules.md and board.md.
