# Rules as DRC

A requirement checked on every compile cannot go stale. This page maps the kinds of rule found in spec sheets, KiCad custom rules and generator asserts onto pcbjs rules, then shows them on one board. `pcbjs docs rules` has every rule and its merge order.

## Where each kind of rule goes

| Requirement | pcbjs |
| --- | --- |
| no part, silk or pad within w of the edge, an enclosure wall or card guide | `rules={{ edge: { width: w, kinds?, except: [J1, 'H1'] } }}`, DRC `edge-courtyard`, `edge-silk`, `edge-pad` |
| solder mask dam of at least w between pads | `rules={{ maskWeb: w }}`, DRC warning `mask-web`; black or white mask usually wants more than green |
| hole to copper differs on inner and outer layers | `holeClearance: { inner, outer }` |
| via to via spacing differs from pad hole to pad hole | `minHoleToHole: { pad, via }` |
| a through-hole pad keeps more from tracks than from its own neighbours | `part.rules({ clearance: { track, via, zone } })`; its own pads keep the board's |
| power tracks keep more from through-hole pads | `net.rules({ clearance: { track } })` or a class; toward pads by type on a part, `{ pad: { tht } }` |
| pads keep more from pours only | `part.rules({ clearance: { zone } })` |
| one side carries no tracks, a battery or shield sits there | `keepout('B.Cu', OUTLINE)`; pads are never flagged, so through-hole parts stay |
| no pour on a board or area | `keepout('all', d, { tracks: false, vias: false })`; each flag set false lets that kind in |
| an antenna, a crystal, a screw head | `keepout('all', d, { except: [NET] })` for the nets that may enter |
| pins across a cable or mezzanine carry the same nets | `reference(entry, { mate: { …, nets: true } })`, DRC `reference-net` |
| a body must clear the board above | `reference()` with real heights, DRC `reference-collision` |
| a skew or length budget | `.match(group, tolerance)` or `.length({ min, max })` |
| rules from a fab's sheet | the fab preset, or a house rule set over several, see house-rules.md |

Keep a script for what no rule expresses: grid snapping, style such as 45 degree corners, distances between named items, which a contract over `inspect --json` checks, see measuring.md.

## One board with them

```tsx
import PCB from '@pcbjs/fab/JLCPCB/4-Layer'
import { nets, route, keepout } from '@pcbjs/core'
import { PinHeader, R0603, C0603 } from '@pcbjs/lib'

const OUTLINE = 'M 0 0 H 40 V 30 H 0 Z'
const { GND, VCC, SIG } = nets()
VCC.rules({ clearance: { track: 0.4 } })

const J1 = PinHeader(3).connect(GND, VCC, SIG).rules({ clearance: { track: 0.4, via: 0.4, zone: 0.4, pad: { tht: 0.5 } } })
const R1 = R0603('10k').connect(SIG, VCC)
const C1 = C0603('100n').connect(VCC, GND)

export default (
  <PCB
    name="Rules"
    rules={{
      edge: { width: 1.2, kinds: ['courtyard', 'silk'], except: [J1] },
      maskWeb: 0.13,
      holeClearance: { inner: 0.33, outer: 0.28 },
      minHoleToHole: { pad: 0.45, via: 0.25 },
    }}
  >
    <path layer="Edge.Cuts" d={OUTLINE} />
    <J1 at="5 10" />
    <R1 at="20 12" />
    <C1 at="20 18" />
    {route(J1[3]).X(R1[1])}
    {route(J1[2]).X(R1[2])}
    {route(R1[2]).X(C1[1])}
    {route(C1[2]).X(J1[1])}
    {keepout('B.Cu', OUTLINE)}
  </PCB>
)
```

- A `kinds` list built outside the JSX needs `as const`, or its type widens to `string[]`.
- `except` takes parts, pad or pin handles and ref strings; a ref string that names nothing is a compile error, which keeps the list honest.
- A KiCad custom rule conditioned on `Pad_Type` maps to `{ pad: { tht } }` or `{ pad: { smd } }`; an `'NPTH'` term has no counterpart and is dropped.
- When a power class rule must spare ground, put GND in a class of its own.

## Prove it bites

For every rule you add, run the probe once and write the result beside the rule:

1. Raise the value by a step, 0.05 mm for a clearance, 0.2 mm for a band, until DRC fires.
2. Note the first item that fires and its distance: that is the margin.
3. Put the value back and check again.

A rule that never fires at any value is a typo: a kind key that matches nothing, a class no net carries, an `except` that covers the whole board.

## What stays a script

- Grid rules, such as vias on a 0.635 mm grid: check `inspect <net> --json` via centres.
- Track style, 45 degree corners, no short jogs, no necked tracks: check `tracks[].pts`.
- Distances between named items, such as "no via within 1 mm of the crystal": a contract, see measuring.md.
- Rules that need the fill, such as "every bus line has unbroken ground below": compare `inspect --layer` items against the zone fill.
