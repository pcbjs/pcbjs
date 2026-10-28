# Differential pairs

`route([aP, aN])` and its chain to `.X([bP, bN])` or `.Z([bP, bN])`: a pair routed as one centre line and laid out as two coupled tracks, its width, gap and impedance, ends, necks, via pairs, rounded corners, fans, length tuning, the pair DRC rules and the limits.
examples/highspeed is a whole board with one pair drawn by hand and one autorouted through a via pair.

```tsx
import PCB from '@pcbjs/fab/JLCPCB/4-Layer'
import { nets, route, NC } from '@pcbjs/core'
import { USBC, SOT23, roundedRect } from '@pcbjs/lib'

const { GND, VBUS, CC1, CC2, DP, DN } = nets({ DP: { class: 'usb' }, DN: { class: 'usb' } })
const J1 = USBC('full16', 'TYPE-C-31-M-12').connect({ GND, VBUS, CC1, CC2, DP, DN, SBU1: NC, SBU2: NC, SHIELD: GND })
const U1 = SOT23(6, { pinNames: { 1: 'IO1', 6: 'IO1', 3: 'IO2', 4: 'IO2', 2: 'GND', 5: 'VBUS' } })('USBLC6-2SC6').connect({ IO1: DP, IO2: DN, GND, VBUS })

export default () => (
  <PCB name="Pairs" classes={{ usb: { gap: 0.15, skew: 0.1 } }}>
    <path layer="Edge.Cuts" d={roundedRect(24, 20, 1)} />
    <J1 at="12 3.4 180deg" />
    <U1 at="12.5 14 90deg" />
    {route([J1.B6, J1.A7]).V(9.4).L(12.5, 10.4).Z([U1.pad('6'), U1.pad('4')]).impedance(90)}
  </PCB>
)
```

## Ends

- Both ends are arrays `[P, N]` of any route end: pin or pad handle, `"REF.PIN"` or coordinate. One array end and one single end is a TypeError.
- `[x, y, layer?]` is one end: an array is a pair only when both elements are positions.
- Nets come from the pads, else a compile error names them; `.net(P, N)` sets both, as a pair between coordinates needs.
- A pin with several pads, `J1.DP` on A6 and B6, takes the pad nearest the far end, N the pad nearest P's; `J1['B6']` names one.
- Every builder method of routing.md works; `.width()` is per track.
- An automatic leg leaves an end with a straight stub: square to the pads away from the footprint centre, then the other way, along them, then the compass directions nearest the far end. It runs a pitch past the pads and fans, then up to the neck length until free. A manual command sets the direction instead.

## The centre line

The path, in the grammar of routing.md, is the centre line: its hidden `M` is the midpoint of the start pads, `Z` goes straight to the midpoint of the end pads, `XZ` autoroutes there.

- An automatic leg runs the maze `2w + g` wide, both nets' copper its own. Knees shorter than half the pitch and turns over 135 degrees are cut where free; drawn vertices never move.
- Once routed, the line is offset `(w + g) / 2` each side, per section between layer changes. A bend too tight is cut, a U turn narrower than the pitch fails.
- Where P and N would come closer than the gap, an automatic via pair slides along the line and a slanted end gets a square approach; else `route-failed` names the point and the nearest copper.
- P runs on its start pad's side. End pads the other way round would cross: `route-failed` at the end, reported before routing when both directions are known; swap with `.cross()`.
- The laid out copper is an obstacle for later legs; when the final layout differs, colliding legs of its priority or lower reroute.
- Tracks carry `Track.pair`, `pair:<n>` in document order, `Track.role`, `P` or `N`, and `Track.route`. `board.pairs` lists each pair's nets, width, gap and limits.

## Width, gap and impedance

| Value | Taken from, first that is set |
| --- | --- |
| width | `.width()`, solved by `.impedance()`, the class `width`, solved by the class `impedance`, the rules' `minTrackWidth` |
| gap | `.gap()`, the class `gap`, solved by `.impedance()` or the class `impedance`, the width |
| skew tolerance | `.skew()`, the class `skew`, 0.1 mm |
| uncoupled limit | the class `uncoupled`, 5 mm |

- `.impedance(ohms)` is differential on the start layer from the stackup, see stackup-and-rules.md. It keeps a set gap and solves the width, with `.width()` solves the gap, with neither solves both with gap equal to width, to 0.01 mm. A class `impedance` does the same.
- On a single route `.impedance(ohms)` is single ended and sets the width unless `.width()` is given.
- Between a pair's own tracks and vias the gap governs, not a larger class clearance, so `clearance: 0.2` with `gap: 0.15` lays out. The rules' clearance still applies; pads keep the class clearance.

## Vias

`@<layer>` in the path, or an automatic layer change, places a via pair, one per net, across the run or the bend bisector.

- Spacing centre to centre is `max(w + g, size + c)`, `c` the largest of the pair's clearance, `minHoleToHole` and `holeClearance`. Wider than the pitch, the tracks flare out to the via centres and back.
- The via is `.vias({ drill, size })`, the class `via`, else the default via.
- `.cross(layer)` is a crossover: P and N swap sides on `layer`, both vias on incoming P's side, N's a little further on. It needs a manual command before it: `route([J1.DP, J1.DN]).v(1.5).cross('B.Cu').X([U1.DP, U1.DN])`.

## Corners

Drawn corners round on the centre line with radius `w + g`, so the tracks turn as concentric arcs.

- A bend leaves the outer track `2h` times the turn longer, `h` the half pitch; turns that cancel leave no skew.
- Short segments or nearby copper shrink the radius to the track width, never below the half pitch, then a 45 degree chamfer, else square.
- Automatic legs keep router corners. `.corner(r)`, `.corner('none')` and the class `corner: { radius }` set it.
- `Track.prims` keeps the arcs for the Gerbers, `Track.pts` has them flattened; lengths follow the arcs.

## Fans and neck-down

Each track runs straight from its pad centre to the far edge of both pads, then fans to the pitch and joins the coupled track at the first point a fan of 45 degrees or shallower reaches with a turn of at most 45 degrees. Tracks that fan out run straight on until they clear the neighbouring pads.

- A fan shorter than a track width runs shallower instead; right past the pads the outer track may leave at up to 67.5 degrees.
- Uncoupled length is the fans and flares of both tracks and any stretch one runs alone. A 2.54 mm header needs a higher class `uncoupled`.
- A pair too wide for its pads necks down like a single route, see routing.md, until it clears the pads and its partner. The neck is its own uncoupled track.

## DRC

| Rule | Severity | Fires when |
| --- | --- | --- |
| `pair-gap` | error | a coupled section is more than 0.01 mm off the gap, edge to edge |
| `pair-skew` | error | the tracks differ in length, via barrels included, by more than the skew tolerance after tuning |
| `pair-uncoupled` | warning | the uncoupled length exceeds the class `uncoupled` |

- `pair-gap` skips segments to a pad or via centre, fans after a pad's straight run, necks and arc chords.
- Lengths are `routeLength`: each side's tracks along their arcs plus each via's depth.
- `pcbjs inspect <entry> <net>` prints the pair: partner, width, gap, lengths, skew and uncoupled length.

## Skew and length tuning

After layout, skew over the tolerance gets a U bump on the shorter track, away from its partner, in its longest coupled run with room, clear of courtyards and silk labels, after length tuning.

- Corners of radius `w + g` down to the track width, at least `w + g + 0.02` mm high, chamfers in tight room. The bump and the partner beside it count as uncoupled.
- A bump adds at least `2 pi - 4` times its radius, 0.39 mm for 0.17 mm tracks at a 0.15 mm gap. A smaller skew is left unless that bump overshoots by no more than the tolerance; `pair-skew` names the floor or why there was no room.

`.length()` and `.match()` on a pair measure its longer track. A short pair, also in a group with single routes, gets U meanders in its centre line, full pair width, so both tracks grow alike; a leftover below the floor grows the last meander or is left, and `length` and `length-match` name the floor. A match tolerance under the floor needs hand evened paths. Amplitude, targets and room are as in length.md; `--lengths` and `board.routes` show what tuning added and what is missing.

## Limits

- A pair with a failed leg places no copper; its nets stay unconnected.
- Two via pairs of one route are kept apart only by the hole rules; place close layer changes with `@` in the path.
- A custom `RouteFn` gets the centre line request with `pair: { partner, width, gap }`, `width` the centre line's.
