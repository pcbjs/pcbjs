# Stackup and design rules

Why the stackup builders, presets and rule values are what they are, with the source of every number.
The reference for props and rule names is in board.md, rules.md, findings.md and fab.md; this file is the background.

## The stackup model

The `Stackup` type and its checks are in board.md. Thicknesses are mm, copper weight oz per square foot, 1 oz being 0.035 mm; `er` is the dielectric constant, `lossTangent` the dissipation factor. `thickness` is the nominal thickness you order, else the sum of the layers; the two may differ by the usual 10%.

## Stackup builders and presets

`@pcbjs/lib/stackups` builds stackups and holds fab presets.

```tsx
import PCB from '@pcbjs/core'
import { fourLayer } from '@pcbjs/lib/stackups'

// JLCPCB_4L_7628 and the other presets go straight into stackup={…}; a builder makes a variant of the generic one
export default <PCB name="Thin" stackup={fourLayer({ thickness: 1.0, finish: 'ENIG', maskColor: 'Black' })}>{/* … */}</PCB>
```

The builders take `thickness`, `outerCopper` and `innerCopper` in oz, `prepreg` in mm, `finish`, `maskColor`, `silkColor`, `material`, `er` and `lossTangent`. The defaults are 1.6 mm, 1 oz outer and 0.5 oz inner copper, FR4 er 4.5 loss tangent 0.02, a 0.01 mm green mask and white legend. Dielectrics alternate prepreg and core, prepreg outermost; the prepregs keep their thickness, the cores take the rest.

The fab presets' rules assume 1 oz copper, and heavier copper etches wider: JLCPCB makes 2 oz at 0.16 mm clearance and track width. A stackup heavier than 1 oz under finer rules draws the ERC warning `copper-weight`, see findings.md; set the rules to the fab's figures, `rules={{ clearance: 0.16, minTrackWidth: 0.16 }}`.

| Builder | Dielectrics at 1.6 mm |
|---|---|
| `twoLayer` | one core, 1.51 mm |
| `fourLayer` | prepreg 0.2, core about 1.06, prepreg 0.2, the shape of JLC04161H-7628 |
| `sixLayer` | three 0.2 mm prepregs, two cores of about 0.42 mm, close to JLC06161H-7628 |
| `eightLayer` | four 0.15 mm prepregs, three cores of about 0.27 mm |

| Preset | What it is | Source |
|---|---|---|
| `JLCPCB_2L` | FR4 1.6 mm, 1 oz, HASL, green | jlcpcb.com capabilities, 2026-10-23 |
| `JLCPCB_4L_7628` | JLC04161H-7628: 7628 prepreg 0.2104 mm er 4.4, 1.065 mm core er 4.6, inner copper 0.0152 mm, HASL, green | jlcpcb.com/impedance, 2026-10-23 |
| `JLCPCB_4L_3313` | JLC04161H-3313: 3313 prepreg 0.0994 mm er 4.1, 1.265 mm core er 4.6, otherwise as 7628; preset `@pcbjs/fab/JLCPCB/4-Layer-3313` | jlcpcb.com/impedance, 2026-10-25 |
| `OSHPARK_2L` | 1.524 mm FR4 core, 1 oz, ENIG, purple | docs.oshpark.com two-layer, 2026-10-23 |
| `OSHPARK_4L` | FR408-HR, 2113 prepreg 0.2 mm, 0.99 mm core, er 3.61, 1 oz outer, 0.5 oz inner, ENIG, purple | docs.oshpark.com four-layer, 2026-10-23 |

The presets are frozen. To change one, spread it into a new object.

## In the fabrication set

The stackup goes into the job file, one `MaterialStackup` per layer, and README-fab's Stackup section, the rules into its Rules section. Finish names are the job format's: HASL `HAL SnPb`, lead-free HASL `HAL lead-free`, none `None`. See fab-set.md.

## Rules

Lengths are mm; rules.md says what each rule checks. The minimums are what the fab can build; maskExpansion, pasteShrink and zoneMinWidth are design choices.

| Rule | Why the BASE value |
|---|---|
| `clearance` | OSH Park's 6 mil on 2 layers is the strictest of the five fabs; the others take 0.1 to 0.15 |
| `minTrackWidth` | the same 6 mil |
| `edgeClearance` | OSH Park keeps 0.381 mm off the edge; 0.4 also clears a V-score at JLCPCB |
| `holeClearance` | JLCPCB asks 0.28 from a plated hole to a track and 0.2 from a via hole, OSH Park and Advanced PCB 0.254 |
| `minHoleToHole` | JLCPCB asks 0.45 between pad holes and 0.2 between via holes, its set `{ pad: 0.45, via: 0.2 }`; Advanced PCB 0.305 |
| `minDrill` | OSH Park and Advanced PCB drill 0.254 at the smallest, JLCPCB and PCBWay charge extra below 0.2 |
| `minViaDrill` | a 0.30 mm via drill, above every fab's minimum |
| `minViaDiameter` | 0.3 drill plus a 0.15 ring on each side |
| `minAnnularRing` | PCBWay and Eurocircuits class 6 ask 0.15, OSH Park and Advanced PCB 0.127 |
| `minPadAnnularRing` | JLCPCB asks 0.18 at least and 0.20 in general on 2-layer 1 oz boards, Advanced PCB 0.178 |
| `silkMinWidth` | JLCPCB and PCBWay print 0.15, OSH Park and Advanced PCB 0.127 |
| `silkMinHeight` | JLCPCB's smallest text height, 1.0; PCBWay prints 0.8 |
| `silkToPad` | JLCPCB's pad to silkscreen figure |
| `maskExpansion` | OSH Park's 2 mil; JLCPCB accepts 1:1; Advanced PCB asks 0.076 and its preset says so |
| `maskWeb` | JLCPCB's soldermask bridge at 1 oz: 0.10 for green, red, yellow, blue and purple, 0.13 for black and white, 0.20 at 2 oz in any colour; the other fabs' standard pages state none |
| `pasteShrink` | stencils are cut 1:1 unless the assembler asks otherwise |
| `zoneMinWidth` | slivers below it etch badly and are removed |
| `thermal` | KiCad's defaults, so boards port cleanly; no fab publishes its own |

`minPadAnnularRing` is a rule of its own because plated pads need more ring than vias at JLCPCB and Advanced PCB, while a single figure for both would forbid the 0.3 / 0.6 via.

`BASE`, the default, is the cross-fab set; a test checks it is as strict as every fab set on every minimum.

## Fab rule sets

`@pcbjs/lib/rules` exports BASE and one set per fab, each a complete `Rules` built from BASE with the fab's own figures. Each carries a doc comment with its source and the date it was read.

| Rule | BASE | JLCPCB | PCBWAY | OSHPARK | EUROCIRCUITS | ADVANCEDPCB |
|---|---|---|---|---|---|---|
| clearance | 0.1524 | 0.127 | 0.1 | 0.1524 | 0.15 | 0.127 |
| minTrackWidth | 0.1524 | 0.127 | 0.1 | 0.1524 | 0.15 | 0.127 |
| edgeClearance | 0.4 | 0.2 | 0.25 | 0.381 | 0.4 | 0.254 |
| holeClearance | 0.3 | 0.28, via 0.2 | 0.2 | 0.254 | 0.2 | 0.254 |
| minHoleToHole | 0.5 | pad 0.45, via 0.2 | 0.41 | 0.127 | 0.5 | 0.305 |
| minDrill | 0.3 | 0.2 | 0.2 | 0.254 | 0.25 | 0.254 |
| minViaDrill | 0.3 | 0.2 | 0.2 | 0.254 | 0.25 | 0.254 |
| minViaDiameter | 0.6 | 0.45 | 0.5 | 0.508 | 0.55 | 0.508 |
| minAnnularRing | 0.15 | 0.125 | 0.15 | 0.127 | 0.15 | 0.127 |
| minPadAnnularRing | 0.2 | 0.18 | 0.15 | 0.127 | 0.15 | 0.1778 |
| silkMinWidth | 0.15 | 0.15 | 0.15 | 0.127 | 0.15 | 0.127 |
| silkMinHeight | 1 | 1 | 0.8 | 1 | 1 | 1 |
| silkToPad | 0.15 | 0.15 | 0.15 | 0.15 | 0.15 | 0.15 |
| maskExpansion | 0.05 | 0.05 | 0.05 | 0.0508 | 0.05 | 0.0762 |
| maskWeb | none | 0.1, black and white 0.13 | none | none | none | none |

JLCPCB allows 0.1 mm track and space on 2 layers and 0.09 mm on multilayer; the preset uses 0.127 mm, ordered without review. Its via 0.2 / 0.45 is the common size without a surcharge. The PCBWay standard page does not state hole to hole or hole to copper, so the advanced tier's figures are used. The Eurocircuits class table is published as an image; the preset holds pattern class 6 and drill class C as commonly published and keeps BASE where nothing was found, so check it before ordering. Values a fab does not state stay at BASE.

Use BASE while the fab is not chosen or the files go to several fabs, a fab's set for its finer limits when you order there, and a fab's set with keys of your own for margin, `mergeRules(JLCPCB, { clearance: 0.2 })`. The sets are frozen; `mergeRules(base, ...overrides)` returns a new set and skips undefined values.

## Impedance

`@pcbjs/lib` computes trace impedance from a stackup in closed form. Lengths are mm, impedances ohms.

```ts
import { impedanceOf, traceWidth, pairGeometry, JLCPCB_4L_7628 } from '@pcbjs/lib'

impedanceOf(JLCPCB_4L_7628, 'F.Cu', 0.2)            // 68.0, single ended
impedanceOf(JLCPCB_4L_7628, 'F.Cu', 0.2, 0.15)      // 103.0, differential with a 0.15 mm gap
traceWidth(JLCPCB_4L_7628, 'F.Cu', 50)              // 0.372
pairGeometry(JLCPCB_4L_7628, 'F.Cu', 90, { gap: 0.15 })   // { width: 0.268, gap: 0.15 }
```

`impedanceOf` is differential when `gap`, edge to edge, is given. `pairGeometry` solves for whichever of width and gap is missing; with neither, the gap equals the width. `traceModel(stackup, layer)` returns the geometry the formulas see.

The planes are the nearest copper layers above and below, so outer layers are microstrip and inner ones stripline, over the summed dielectrics with their thickness-weighted er. Microstrip is Hammerstad and Jensen, stripline Wheeler 1978 with KiCad's off-centre combination, pairs the IPC-2141A edge coupled forms; citations are in `packages/core/src/impedance.ts`. Every copper layer counts as a solid plane; the mask is ignored. Against a field solve, microstrip is within 2 to 3 percent, stripline within 4, up to 8 high far off centre. A mask lowers an outer trace by 2 to 3 ohms, so JLCPCB's calculator gives 0.34 mm for 50 ohm on 7628 F.Cu where the model gives 0.37. Treat the numbers as a start; order controlled impedance from the fab's solver when it matters.

### What the presets give

From `traceWidth` and `pairGeometry` with the gap equal to the width, in mm; B.Cu matches F.Cu. A 0.5 mm pitch pad is 0.25 to 0.3 mm wide.

| Stackup, presets | Layer | 50 ohm | 90 ohm pair, w / gap | 100 ohm pair, w / gap |
|---|---|---|---|---|
| `twoLayer`, every 2-Layer but OSH Park | F.Cu | 2.80 | 2.93 / 2.93 | 2.26 / 2.26 |
| `OSHPARK_2L` | F.Cu | 2.82 | 2.96 / 2.96 | 2.28 / 2.28 |
| `JLCPCB_4L_7628`, JLCPCB 4-Layer | F.Cu | 0.37 | 0.38 / 0.38 | 0.29 / 0.29 |
| | In1.Cu | 0.30 | 0.23 / 0.23 | 0.16 / 0.16 |
| `JLCPCB_4L_3313`, JLCPCB 4-Layer-3313 | F.Cu | 0.17 | 0.18 / 0.18 | 0.13 / 0.13 |
| | In1.Cu | 0.15 | 0.09 / 0.09 | 0.06 / 0.06 |
| `fourLayer`, PCBWay, Eurocircuits, AdvancedPCB 4-Layer | F.Cu | 0.35 | 0.36 / 0.36 | 0.26 / 0.26 |
| | In1.Cu | 0.29 | 0.21 / 0.21 | 0.15 / 0.15 |
| `OSHPARK_4L` | F.Cu | 0.40 | 0.44 / 0.44 | 0.34 / 0.34 |
| | In1.Cu | 0.35 | 0.30 / 0.30 | 0.22 / 0.22 |
| `sixLayer`, JLCPCB 6-Layer | F.Cu | 0.35 | 0.36 / 0.36 | 0.26 / 0.26 |
| `eightLayer`, JLCPCB 8-Layer | F.Cu | 0.25 | 0.26 / 0.26 | 0.19 / 0.19 |

A fixed 0.15 mm gap narrows the pair: 90 ohm is 0.27 mm on 7628, 0.17 mm on 3313 and 1.10 mm on a 1.6 mm 2-layer board, whose plane is 1.5 mm away, too wide for any fine pitch pad. Such a route keeps its impedance width only away from the pads and necks down at them, `route(a, b).neck({ width, length })`, see pairs.md; the necked stretch is off impedance, which a short USB 2.0 run tolerates. Real 2-layer boards reach 90 ohm with a coplanar waveguide, ground poured beside the pair, which pcbjs does not model. For anything faster use 4 layers, and at fine pitch the 3313 preset. The ERC warning `impedance-width` fires when a solved width is more than twice the smaller side of the pad the route starts at, with both numbers.

A net class with `impedance` and no `width` takes its width from `traceWidth` for each route's start layer, see routing.md. `route(a, b).impedance(ohms)` does the same for one route, and on a differential pair it takes width and gap from `pairGeometry`, see pairs.md.

## Defaults: the fine print

The levels and the helpers are in board.md. `defineDefaultBoard` and `defineDefaultRules` each take a partial, set the default layer to the base plus that partial and return the full merged result, frozen; build on an earlier default by spreading it, `defineDefaultRules({ ...tight, minDrill: 0.25 })`. Spreading a full result into `defineDefaultRules` sets every key in that layer and hides the rules of `defineDefaultBoard`, so pass a partial when both are in use. Presets, fab sets and helper results are deeply frozen, each board gets its own copy, and the registry is on `globalThis`, shared by `pcb.config.ts`, modules and entries.
