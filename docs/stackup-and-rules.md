# Stackup and design rules

Why the stackup builders, presets and rule values are what they are, with the source of every number.
The reference for props and rule names is in board.md, rules.md, findings.md and fab.md; this file is the background.

```tsx
import PCB from '@pcbjs/core'
import { fourLayer } from '@pcbjs/lib/stackups'

// JLCPCB_4L_7628 and the other presets go straight into stackup={…}; a builder makes a variant of the generic one
export default <PCB name="Thin" stackup={fourLayer({ thickness: 1.0, finish: 'ENIG', maskColor: 'Black' })}>{/* … */}</PCB>
```

## Stackups

The `Stackup` type is in board.md. Thickness in mm, copper weight in oz, 1 oz being 0.035 mm, `er` the dielectric constant, `lossTangent` the dissipation factor; `thickness` is the nominal order, else the sum of the layers, which may differ by 10%.

| Builder option | Default |
| --- | --- |
| `thickness` | 1.6 mm |
| `outerCopper`, `innerCopper` | 1 oz, 0.5 oz |
| `prepreg` | mm, kept; the cores take the rest, prepreg outermost |
| `material`, `er`, `lossTangent` | FR4, 4.5, 0.02 |
| `finish`, `maskColor`, `silkColor` | a 0.01 mm green mask, white legend |

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

- Presets are frozen; spread one into a new object to change it.
- Preset rules assume 1 oz. Heavier copper under finer rules draws the ERC warning `copper-weight`; JLCPCB makes 2 oz at 0.16 mm, so `rules={{ clearance: 0.16, minTrackWidth: 0.16 }}`.
- The fab set's job file has one `MaterialStackup` per layer, README-fab a Stackup and a Rules section. Finishes in the job format: HASL `HAL SnPb`, lead-free HASL `HAL lead-free`, none `None`. See fab-set.md.

## Rules

Lengths in mm; rules.md says what each checks. Minimums are what fabs build; maskExpansion, pasteShrink and zoneMinWidth are design choices.

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
| `minPadAnnularRing` | JLCPCB asks 0.18 at least and 0.20 in general on 2-layer 1 oz boards, Advanced PCB 0.178; separate so the 0.3 / 0.6 via stays legal |
| `silkMinWidth` | JLCPCB and PCBWay print 0.15, OSH Park and Advanced PCB 0.127 |
| `silkMinHeight` | JLCPCB's smallest text height, 1.0; PCBWay prints 0.8 |
| `silkToPad` | JLCPCB's pad to silkscreen figure |
| `maskExpansion` | OSH Park's 2 mil; JLCPCB accepts 1:1; Advanced PCB asks 0.076 and its preset says so |
| `maskWeb` | JLCPCB's soldermask bridge at 1 oz: 0.10 for green, red, yellow, blue and purple, 0.13 for black and white, 0.20 at 2 oz in any colour; the other fabs' standard pages state none |
| `pasteShrink` | stencils are cut 1:1 unless the assembler asks otherwise |
| `zoneMinWidth` | slivers below it etch badly and are removed |
| `thermal` | KiCad's defaults, so boards port cleanly; no fab publishes its own |

## Fab rule sets

```ts
import { JLCPCB, mergeRules } from '@pcbjs/lib/rules'

export const rules = mergeRules(JLCPCB, { clearance: 0.2 }) // a fab's set with margin
```

`@pcbjs/lib/rules` exports `BASE`, the default, and one complete `Rules` per fab built from it, each with a doc comment naming its source and date. A test checks BASE is as strict as every fab set. The sets are frozen; `mergeRules(base, ...overrides)` returns a new set and skips undefined values.

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

- JLCPCB allows 0.1 mm on 2 layers and 0.09 mm multilayer; the set uses 0.127, ordered without review. Its 0.2 / 0.45 via has no surcharge.
- PCBWay's standard page omits hole to hole and hole to copper, so its advanced tier is used.
- Eurocircuits publishes its class table as an image; the set holds pattern class 6 and drill class C as commonly published and BASE elsewhere, so check before ordering.
- Values a fab does not state stay at BASE. Use BASE until the fab is chosen or for several fabs.

## Impedance

```ts
import { impedanceOf, traceWidth, pairGeometry, JLCPCB_4L_7628 } from '@pcbjs/lib'

impedanceOf(JLCPCB_4L_7628, 'F.Cu', 0.2)            // 68.0, single ended
impedanceOf(JLCPCB_4L_7628, 'F.Cu', 0.2, 0.15)      // 103.0, differential with a 0.15 mm gap
traceWidth(JLCPCB_4L_7628, 'F.Cu', 50)              // 0.372
pairGeometry(JLCPCB_4L_7628, 'F.Cu', 90, { gap: 0.15 })   // { width: 0.268, gap: 0.15 }
```

- Lengths mm, impedances ohms. `impedanceOf` is differential when `gap`, edge to edge, is given. `pairGeometry` solves the missing one of width and gap, with neither the gap equals the width. `traceModel(stackup, layer)` returns the geometry the formulas see.
- Planes are the nearest copper layers above and below, all solid, mask ignored: outer layers are microstrip, inner stripline, over the summed dielectrics with thickness-weighted er.
- Microstrip is Hammerstad and Jensen, stripline Wheeler 1978 with KiCad's off-centre combination, pairs IPC-2141A edge coupled; citations in `packages/core/src/impedance.ts`.
- Against a field solve: microstrip within 2 to 3 percent, stripline within 4, up to 8 far off centre. A mask lowers an outer trace 2 to 3 ohms: JLCPCB's calculator gives 0.34 mm for 50 ohm on 7628 F.Cu, the model 0.37. Order controlled impedance from the fab's solver when it matters.

From `traceWidth` and `pairGeometry` with gap equal to width, in mm; B.Cu matches F.Cu. A 0.5 mm pitch pad is 0.25 to 0.3 mm wide.

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

- A fixed 0.15 mm gap gives 90 ohm at 0.27 mm on 7628, 0.17 mm on 3313 and 1.10 mm on a 1.6 mm 2-layer board, too wide for fine pitch pads. Such a route necks down at the pads, `route(a, b).neck({ width, length })`, off impedance there; see pairs.md.
- Real 2-layer boards reach 90 ohm with a coplanar waveguide, which pcbjs does not model. Use 4 layers for anything faster, 3313 at fine pitch.
- The ERC warning `impedance-width` fires when a solved width is over twice the smaller side of the start pad, with both numbers.
- A class `impedance` with no `width`, or `route(a, b).impedance(ohms)`, takes its width from `traceWidth` for the start layer, see routing.md; on a pair, width and gap from `pairGeometry`.

## Defaults

The levels are in board.md. `defineDefaultBoard` and `defineDefaultRules` take a partial, set the default to the base plus it, and return the full merged result, frozen. Build on one by spreading, `defineDefaultRules({ ...tight, minDrill: 0.25 })`; spreading a full result sets every key and hides `defineDefaultBoard`'s rules, so pass a partial when both are used.

Presets, fab sets and helper results are deeply frozen, each board gets its own copy, and the registry is on `globalThis`, shared by `pcb.config.ts`, modules and entries.
