# Rules

The rule values a board is checked against, their overrides per pad, part and net, and the fab rule sets.
The DRC and ERC findings these rules raise are in findings.md; the sources and reasoning behind each value are in stackup-and-rules.md.

```tsx
import PCB from '@pcbjs/core'
export default <PCB name="B" rules={{ clearance: 0.2, thermal: { gap: 0.3 }, maskWeb: 0.13, edge: { width: 1.2, except: [J1] } }} />
```

```ts
import { JLCPCB, mergeRules } from '@pcbjs/lib/rules'

const rules = mergeRules(JLCPCB, { clearance: 0.2 })   // the same as { ...JLCPCB, clearance: 0.2 }
```

## Rules

Set on `<PCB rules>`, a preset or `defineDefaultRules`, in mm. Without any, `BASE`, which JLCPCB, PCBWay, OSH Park, Eurocircuits and Advanced PCB all accept.

| Rule | BASE | Used by |
| --- | --- | --- |
| `clearance` | 0.1524 | copper to copper of another net; zone fill; the router |
| `minTrackWidth` | 0.1524 | `track-width`; the default route width |
| `edgeClearance` | 0.4 | copper to the outline; zones are inset by it |
| `holeClearance` | 0.3 | `hole-to-copper`; zone fill and the router; or `{ inner, outer, via }`, see Hole rules by side |
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
| `maskWeb` | none | `mask-web`, see Mask web |
| `maskWebByColor` | none | by mask colour, see Mask web |
| `pasteShrink` | 0 | paste shrink inside each SMD pad, per side |
| `zoneMinWidth` | 0.25 | pour necks narrower are removed |
| `islands` | 'remove' | 'remove', 'keep' or `{ minArea }`, pours.md Islands |
| `thermal` | gap 0.5, spokeWidth 0.5, spokes 4, angle 90, minSpokes 2 | thermal reliefs, KiCad's defaults, merged key by key; `angle` also per pad and part |
| `strictNets` | false | string nets are compile errors once the board uses parts or `Net` values |
| `requireSourcing` | false | a BOM row without any part number is the ERC warning `unsourced-part` |
| `edge` | none | `{ width, kinds?, except? }`, see Edge band |

Default via: drill `max(0.3, minViaDrill, minDrill)`, diameter `max(0.6, minViaDiameter, drill + 2 × minAnnularRing)`, 0.3 and 0.6 in `BASE`.

### Hole rules by side

```tsx
import PCB from '@pcbjs/core'
export default <PCB name="B" rules={{ holeClearance: { inner: 0.33, outer: 0.28, via: 0.2 }, minHoleToHole: { pad: 0.45, via: 0.2 } }} />
```

- `outer` holds on F.Cu and B.Cu, `inner` on inner layers, `via` from a via hole on every layer. `minHoleToHole.via` holds between two vias, `pad` between any other two holes. `JLCPCB` carries JLCPCB's values.
- A number means both sides; an object merges side by side over the level below.
- DRC and the fill use each side; the router and tuner keep the larger. Findings say `(inner layers)`, `(via hole)` or `(via to via)`, README-fab lists the sides.

### Edge band

```tsx
import PCB from '@pcbjs/core'
export default <PCB name="B" rules={{ edge: { width: 1.2, kinds: ['courtyard', 'silk', 'pad'], except: [J_CAM0, J1.pad(3), 'MH1'] } }} />
```

- Keeps a band `width` mm inside the outline and around cutouts clear of `kinds`, default all three.
- `except` takes parts, pad or pin handles, or ref strings `'J1'`, `'J1.3'`. An unplaced part is ignored; a ref naming nothing is a compile error.
- Merges key by key over a lower level, so a board may add `except`. DRC `edge-courtyard`, `edge-silk`, `edge-pad` give the distance. The router ignores it.

### Mask web

- `maskWeb: 0.13` asks for that much mask between two pad openings, each pad grown by its `maskExpansion` as the Gerber draws it; exactly `maskWeb` passes.
- The DRC warning `mask-web` names both pads and the web, one finding per part naming its narrowest pair and counting the rest: `mask web between pad U1.1 and pad U1.2 on F.Mask is 0.1 mm, narrower than 0.13 mm, and 43 more pairs of U1; the fab merges the openings`.
- Touching or overlapping openings pass, and so does a pad opening that meets a drawing on its mask layer, a gang opening.
- `JLCPCB` carries 0.1, fab.md; the other sets check nothing.
- `maskWebByColor: { Black: 0.13 }`, case ignored, picks by the stackup's or preset's `color` over `maskWeb`. A level setting `maskWeb` without a table drops the tables below.

## Overrides

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

- Precedence pad, part, class, board, key by key. The part level merges `<footprint rules>`, then `.rules()` calls in order, then the placement.
- Between two items, as KiCad: if either has an override toward the other, the larger override holds and classes and board are skipped, so `clearance: 0.15` on a part lets any track 0.15 mm from its pads. Else the larger class clearance, else the board's.
- `holeClearance`: the larger of hole and copper. `edgeClearance`: per pad. `trackWidth`: the narrowest track ending on a pad of the part, the larger of two parts.
- Findings name the source: `(part override of J1)`, `(pad override of U3.4)`, `(class power)`, plus `, to tracks` or `, to its own pads` when scoped.
- The fill keeps an override toward zones or the pour's `clearance`, whichever is larger; router and tuner keep one toward tracks, never below the rules'.
- `pcbjs import board` writes them from KiCad's clearances and the `.kicad_dru` rules it can map, import.md.

### Clearance by kind

`clearance` is one length, or an object by the other item's kind: `pad`, `track`, `via`, `zone`, `text`. A kind left out keeps the class's or board's.

- On a pad or part, `self` is the clearance between pads of one footprint, as `J2` above; a plain length holds there too, as KiCad's local clearance.
- `pad` takes the other pad's type, `{ pad: { tht: 0.5, smd: 0.2 } }`, KiCad's `Pad_Type`; an npth or a type left out keeps the class's or rules'. A `pad` object replaces a lower one; findings say `, to tht pads`.
- On a class or net it holds for its tracks and vias and counts as an override: `power: { clearance: { track: 0.4 } }`.
- Two objects merge kind by kind, else the upper level replaces; a pad's `clearance` replaces its part's.
- A pad's `thermal` is `'thermal'`, `'solid'`, `'none'` or `{ connect?, angle? }`, over its part's `thermal.angle` and the rules'; footprint and placement `thermal` maps take the same.

## Fab rule sets

`@pcbjs/lib/rules` exports `BASE`, `JLCPCB`, `PCBWAY`, `OSHPARK`, `EUROCIRCUITS` and `ADVANCEDPCB`, frozen; `mergeRules(base, ...overrides)` returns a new set. A preset from `@pcbjs/fab/...` carries its fab's set, fab.md.
