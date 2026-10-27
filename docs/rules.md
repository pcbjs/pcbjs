# Rules

The rule values a board is checked against, their overrides per pad, part and net, and the fab rule sets.
The DRC and ERC findings these rules raise are in findings.md; the sources and reasoning behind each value are in stackup-and-rules.md.

## Rules

Set them on the board, `<PCB rules={{ clearance: 0.2 }}>`, or through a preset or `defineDefaultRules`. Values are mm. A board without rules gets `BASE`, which JLCPCB, PCBWay, OSH Park, Eurocircuits and Advanced PCB all accept.

| Rule | BASE | Used by |
| --- | --- | --- |
| `clearance` | 0.1524 | copper to copper of another net; zone fill; the router |
| `minTrackWidth` | 0.1524 | `track-width`; the default route width |
| `edgeClearance` | 0.4 | copper to the outline; zones are inset by it |
| `holeClearance` | 0.3 | `hole-to-copper`; zone fill and the router; or `{ inner, outer, via }` by copper layer and via hole, see Hole rules by side |
| `minHoleToHole` | 0.5 | `hole-to-hole`; routed vias; or `{ pad, via }` by kind of hole |
| `minDrill` | 0.3 | `drill` |
| `minViaDrill` | 0.3 | `via-drill`; the default via |
| `minViaDiameter` | 0.6 | `via-size`; the default via |
| `minAnnularRing` | 0.15 | `annular-ring` for vias; the default via |
| `minPadAnnularRing` | 0.2 | `annular-ring` for plated pads |
| `silkMinWidth` | 0.15 | `silk-width`; the default silk text thickness |
| `silkMinHeight` | 1 | the smallest silk ref height, see layout.md Silk refs |
| `silkToPad` | 0.15 | listed in README-fab, not enforced |
| `maskExpansion` | 0.05 | mask opening beyond each pad, per side |
| `maskWeb` | none | `mask-web`: the narrowest solder mask between two pad openings, see Mask web |
| `maskWebByColor` | none | `maskWeb` by mask colour, `{ Black: 0.13 }`, see Mask web |
| `pasteShrink` | 0 | paste shrink inside each SMD pad, per side |
| `zoneMinWidth` | 0.25 | zone slivers and necks narrower than this are removed, as KiCad's min thickness |
| `islands` | 'remove' | pour pieces joined to no pad or via of their net: 'remove', 'keep' or `{ minArea }`, see pours.md Islands |
| `thermal` | gap 0.5, spokeWidth 0.5, spokes 4, angle 90, minSpokes 2 | thermal reliefs of pours, KiCad's defaults, merged key by key: `{ thermal: { gap: 0.3 } }`; `angle` also per pad and part, see Overrides |
| `strictNets` | false | a string net is a compile error once the board uses parts or `Net` values |
| `requireSourcing` | false | a BOM row without any part number is the ERC warning `unsourced-part` |
| `edge` | none | `{ width, kinds?, except? }`: a band along the outline that courtyards, silk and pads stay out of, see Edge band |

The default via, for a `<via>` or a routed via without a size, has a drill of `max(0.3, minViaDrill, minDrill)` and a diameter of `max(0.6, minViaDiameter, drill + 2 × minAnnularRing)`. With `BASE` that is 0.3 and 0.6.

### Hole rules by side

`holeClearance: { inner: 0.33, outer: 0.28 }` holds hole to copper at 0.28 on F.Cu and B.Cu and 0.33 on the inner layers. `minHoleToHole: { pad: 0.45, via: 0.2 }` holds two vias 0.2 apart and any other two holes, a pad's or a via and a pad, 0.45 apart, as JLCPCB states it, which `JLCPCB` carries. A number means both sides. An object merges side by side over a lower level's, so `{ inner: 0.33 }` keeps the outer value below it. DRC and the zone fill use each side; the router and length tuning keep the larger, so routed copper passes on every layer. `via` sets hole to copper from a via's hole on every layer, `{ via: 0.2 }` for JLCPCB's via hole to track, which `JLCPCB` carries; a pad's hole keeps its layer's side. Findings say `(inner layers)`, `(via hole)` or `(via to via)`, and README-fab lists the sides.

### Edge band

`rules={{ edge: { width: 1.2, kinds: ['courtyard', 'silk', 'pad'], except: [J_CAM0, J1.pad(3), 'MH1'] } }}` on `<PCB>`, a preset, a variant target or `defineDefaultRules` keeps a band `width` mm wide inside the outline and around every cutout clear, as an enclosure's sidewall asks. `kinds` defaults to all three. `except` lets parts in, a part for its courtyard, silk and pads, or one pad: a part, a pad or pin handle, or a ref string, `'J1'` or `'J1.3'`. A part not placed on the board is ignored; a ref string that names nothing on it is a compile error. `edge` merges key by key over a lower level's, so a board may add `except` to a preset's band. The DRC rules `edge-courtyard`, `edge-silk` and `edge-pad` name the item and its distance to the edge. The router does not read it.

### Mask web

`rules={{ maskWeb: 0.13 }}` on `<PCB>`, a preset, a variant target or `defineDefaultRules` asks for at least that much solder mask between two pad openings, as the fab can hold a dam no thinner; below it the fab merges the openings. The openings are the ones the mask Gerber draws, each pad grown by its `maskExpansion`, so DRC and the writer agree. The DRC warning `mask-web` names both pads and the web, `mask web between pad U1.1 and pad U1.2 on F.Mask is 0.1 mm, narrower than 0.13 mm, and 43 more pairs of U1; the fab merges the openings`; the pads of one part are one finding for the part, naming its narrowest pair and counting the others, and pads of two parts one finding per pair.

- Openings that already touch or overlap are merged, and pass.
- A pad whose opening meets a graphic or text drawn on its side's mask layer, such as a gang opening over a fine-pitch connector, is merged on purpose and not checked.
- A web of exactly `maskWeb` passes. `JLCPCB` carries 0.1, see fab.md; the other sets leave it out, so nothing is checked.
- `maskWebByColor: { Black: 0.13 }` gives the web by mask colour, case ignored: the board's mask colour, from its stackup or the preset's `color`, picks the value over `maskWeb`. A level that sets `maskWeb` without a table drops the tables below it, so `maskWeb` stays the override.

## Overrides

A pad, a part or a net may ask for other values than the board's, such as a fine-pitch part or a connector at the board edge.

```tsx
import PCB, { nets, defineFootprint } from '@pcbjs/core'

const Edge = defineFootprint(props => (
  <footprint {...props}>
    <pad num={1} at="0 0" size={1} clearance={0.12} pasteShrink={0.03} />
    <pad num={2} at="1.2 0" size={1} clearance={0.12} holeClearance={0.2} drill={0.4} />
  </footprint>
), { pins: ['1', '2'], prefix: 'J' })

const { A, B, GND, VCC } = nets()
GND.rules({ clearance: 0.3 })
VCC.rules({ clearance: { pad: 0.5, track: 0.4 } })
const J1 = Edge().connect(A, B).rules({ edgeClearance: 0.26 })
const J2 = Edge().connect(VCC, GND).rules({ clearance: { track: 0.4, via: 0.4, zone: 0.4 }, thermal: { angle: 45 } })

export default (
  <PCB name="Overrides" rules={{ clearance: 0.2 }}>
    <rect layer="Edge.Cuts" x={0} y={0} w={20} h={10} />
    <J1 at="0.8 5" rules={{ trackWidth: 0.1 }} />
    <J2 at="10 5" />
  </PCB>
)
```

| Level | Where | Keys |
| --- | --- | --- |
| pad | props of `<pad>` in a footprint | `clearance`, `holeClearance`, `maskExpansion`, `pasteShrink`, `pasteRatio`, `thermal` |
| part | `part.rules({ … })`, `rules={{ … }}` on its placement or on a `<footprint>`, for every pad of the part | `clearance`, `edgeClearance`, `holeClearance`, `trackWidth`, `thermal: { angle }` |
| net | a net class, see routing.md, or `net.rules({ clearance })`, an anonymous class `net:<name>` merged over the net's own class | `clearance` |
| board | `rules` | every rule |

- Precedence: pad, then part, then class, then board. A key the pad leaves out comes from its part, and so on down. The part level merges key by key: `<footprint rules>`, then `.rules()` calls in order, then the placement.
- Between two items, KiCad's way: when either asks an override toward the other, the larger override of the two holds and classes and board are not consulted, so a part with `clearance: 0.15` may have a track of any net 0.15 mm from its pads. Otherwise the larger class clearance of the two nets holds, else the board's, so a class clearance below the rules' holds only between two nets that both ask for less.
- `holeClearance` holds between a hole and other copper, the larger of the two. `edgeClearance` holds per pad. `trackWidth` is the narrowest track whose end lies on a pad of the part, the larger of two such parts.
- Findings name the override that set the value: `(part override of J1)`, `(pad override of U3.4)`, `(class power)`, with `, to tracks` or `, to its own pads` for a scoped one.
- Zone fill keeps an override toward zones, or the pour's own `clearance` where larger. The router and length tuning keep an override toward tracks where larger, never below the rules' clearance.
- `pcbjs import board` writes these from KiCad's pad and footprint clearances and the `.kicad_dru` rules it can map, see import.md.

### Clearance by kind

`clearance` takes one length, which holds toward every item, or an object keyed by the kind of the other item: `pad`, `track`, `via`, `zone` and `text`. A kind left out is not overridden: the class's or the board's clearance holds there.

- On a pad or a part it also takes `self`, the clearance between pads of the same footprint, else the class's or the board's: `J2` above keeps tracks, vias and pours 0.4 mm from its pads while its own pads may sit closer. A plain length holds between its own pads too, as KiCad's local clearance does.
- `pad` also takes the other pad's type, `{ pad: { tht: 0.5, smd: 0.2 } }`, as KiCad's rules on `Pad_Type`: a type left out, and a non-plated hole, keeps the class's or the rules' clearance; a number holds toward both. A `pad` object replaces a lower level's `pad`, and findings say `, to tht pads`.
- On a class or a net it holds for its tracks and vias: `power: { clearance: { track: 0.4 } }` keeps power tracks and vias 0.4 mm from other nets' tracks; power pads keep the board's. It counts as an override, so between a `VCC` track and `J2`'s pads 0.5 holds.
- Two objects merge kind by kind; otherwise the upper level replaces. A pad's own `clearance` replaces its part's.
- A pad's `thermal` is `'thermal'`, `'solid'`, `'none'` or `{ connect?, angle? }`; `angle: 45` turns its spokes between the axes, over its part's `thermal.angle` and the rules'. The `thermal` maps of a footprint and a placement take the same values.

## Fab rule sets

`@pcbjs/lib/rules` exports `BASE` and one frozen set per fab: `JLCPCB`, `PCBWAY`, `OSHPARK`, `EUROCIRCUITS` and `ADVANCEDPCB`. `mergeRules(base, ...overrides)` returns a new set:

```ts
import { JLCPCB, mergeRules } from '@pcbjs/lib/rules'

const rules = mergeRules(JLCPCB, { clearance: 0.2 })   // the same as { ...JLCPCB, clearance: 0.2 }
```

A fab preset from `@pcbjs/fab/...` already carries its fab's set, see fab.md.
