# What the importer writes and how KiCad maps

`npx pcbjs docs import` and `npx pcbjs docs kicad` have the full detail. This is what a porter checks first.

## Files

| File | Holds |
| --- | --- |
| `pcb.tsx` | `<PCB>` with name, revision, stackup and net classes; outline; placements grouped by ref prefix; text; the copper and art |
| `pcb.sch.ts` | nets with KiCad's names made identifiers, `+5V` as `P5V`, `/D6` as `D6`; one part per footprint named by its ref, with `bom`, `pos`, `dnp` and each pin's net |
| `pcb.sourcing.ts` | MPN, Manufacturer, LCSC as `MPN:LCSC` and the project's fields, from footprints with the `.kicad_sch` symbols over them |
| `pcb.copper.tsx` | pours, keepouts, every net's tracks as `route()` chains of `.Z()` segments with `.neck(AS_DRAWN)`, vias, arcs |
| `pcb.art.tsx` | board silk, Fab and user graphics in KiCad's draw order |
| `lib/<Name>.tsx` | footprints that are not the installed library's own, deduplicated |
| `lib/kicad.ts` | `kicadFootprint()` for footprints matching the installed library |
| `pcb.config.ts` | the entry and rules from the `.kicad_pro`; each `.kicad_dru` rule as a comment saying what it became |

## Frame and placement

- mm, x right, y down in both tools; a coordinate copied from KiCad lands at the same place.
- Rotation is counter-clockwise on screen in both.
- A back part: KiCad flips about the local x axis, pcbjs mirrors about local y and rotates, so KiCad `(layer "B.Cu") (at x y a)` is `at="x y (a+180)deg" side="B"`.
- Refs stay KiCad's: `R1` binds by its variable name, anything else, such as `J_HR`, by `.ref('J_HR')`.
- `pcbjs inspect J1` prints every pad's board centre; compare against KiCad with it, never by hand.

## Pads and footprints

- smd, thru_hole, np_thru_hole as `npth`, connect pads; rect, circle, oval and roundrect map one to one; trapezoids, chamfers, offset copper and custom pads become `shape: 'custom'`.
- A padstack whose front shape differs is two pads of one number, the back shape on every layer and the front shape on F.Cu.
- Mask and paste margins, paste ratios, zone connection and `thermal_bridge_angle` as `thermal: { angle: 45 }`; a pad's own clearance as its `clearance`.
- `net_tie_pad_groups` as `netTie`, so a Kelvin shunt's sense tabs touch its pads without a `short`.
- `remove_unused_layers` keeps only the layers a track or zone joins in some placement.
- Footprints that differ only in element order, courtyard, 1 µm coordinates or pad zone connections merge into one module; the zone connections become a placement `thermal` map.
- `kicadFootprint('Lib:Name', { pinNames, silk: 'none', model })` reads a library footprint in code, so the `.kicad_mod` stays the single source. Its pins are the pad numbers; `pinNames` renames them. The libraries searched are the project's `.pretty` folders, `kicad.footprints` in the config, `KICAD_FOOTPRINTS` and the installed library.

## Rules

| KiCad | pcbjs |
| --- | --- |
| board minimums and Default class | `rules`: clearance, track width, edge and hole clearance, drills, rings, hole to hole, mask expansion |
| silk text thickness | `silkMinWidth`, set to the thinnest silk the board draws, since pcbjs checks lines too |
| zone relief | `thermal` from the most common relief |
| `.kicad_dru` rule on one footprint, `A.Reference == 'J1'` | `J1.rules({ … })` |
| `.kicad_dru` rule on a net class | that class's `clearance` |
| a rule over a list of nets | a class of those nets named after the rule |
| a pad type against an item kind | a part clearance by kind, `{ track: 0.4 }`, on every such part |
| a track or via of a net or class against a kind | a clearance by kind on that net or class |
| `B.Pad_Type == 'Through-hole'` or `'SMD'` | `{ pad: { tht } }` or `{ pad: { smd } }` |
| anything else | a comment in `pcb.config.ts` and a note |

Prove every mapped rule bites: raise it a step until DRC fires, then put it back.

## Text

KiCad stroke text becomes `font="newstroke"` at KiCad's `size`, `width` and `thickness`, `at` moved to KiCad's baseline with `kicadStrokeShift` of `@pcbjs/kicad`, so the ink lands on KiCad's. A label written by hand in the port wants the same:

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { kicadStrokeShift } from '@pcbjs/kicad'

const PIN = { size: 1.2, width: 1.4, thickness: 0.25, font: 'newstroke' } as const

/** KiCad's centred (x, y, angle) as pcbjs's at. */
function kat(x: number, y: number, deg: number) {
  const [dx, dy] = kicadStrokeShift({ size: [PIN.size, PIN.width], thickness: PIN.thickness, justify: [] })
  const t = deg * Math.PI / 180
  return `${x + dx * Math.cos(t) + dy * Math.sin(t)} ${y - dx * Math.sin(t) + dy * Math.cos(t)} ${deg}deg`
}

export default (
  <PCB name="Labels">
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={10} />
    <text layer="F.SilkS" at={kat(5, 5, 0)} {...PIN}>1</text>
    <text layer="F.SilkS" at={kat(10, 5, 90)} {...PIN}>GND</text>
  </PCB>
)
```

TrueType board text is drawn in the installed font, copied to `fonts/` with its licence.

## Models

A `.kicad_mod` model line maps one to one, offset, scale and rotate in KiCad's order. `${KICAD10_3DMODEL_DIR}` and older names resolve to the installed library, `${KIPRJMOD}` to the project root. `pcbjs model add <file> --ref U1 --write` copies a file into `models/` when the port should own it.

## After the import

1. `pcbjs check --fab` and decide each finding.
2. Name the pins you will connect by name.
3. Replace routes you want redone with `.X()` legs; `.lock()` the ones to keep. Drop `.neck(AS_DRAWN)` on a chain you redo.
4. Swap `lib/` footprints for standard library families where one fits, `pcbjs docs stdlib`.
5. Move the stackup and rules to a fab preset when the board is ordered there, `pcbjs docs fab`.
