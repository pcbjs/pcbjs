# Differential pairs

`route([aP, aN])` and its chain to `.X([bP, bN])` or `.Z([bP, bN])`: a pair routed as one centre line and laid out as two coupled tracks, its width, gap and impedance, ends, necks, via pairs, rounded corners, fans, length tuning, the pair DRC rules and the limits.
examples/highspeed is a whole board with one pair drawn by hand and one autorouted through a via pair.

## The route call

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

- Both ends are arrays `[P, N]`, each element any route end: a pin or pad handle, a `"REF.PIN"` string or a coordinate. One array end and one single end is a TypeError at the call.
- A coordinate tuple `[x, y, layer?]` is still one end: an array is a pair only when both of its elements are positions.
- The nets come from the pads, P ends on one net and N ends on another, else a compile error names the pads. `.net(P, N)` gives both, which a pair between coordinates needs.
- A pin with several pads, such as `J1.DP` on A6 and B6, takes the pad nearest the far end for P and the N pad nearest it; `J1['B6']` names one.
- Every builder method of routing.md works. `.width()` is the width of each track.

## The centre line

The path is the centre line of the pair, in the grammar of routing.md. Its hidden `M` is the midpoint of the two start pads, `Z` draws straight to the midpoint of the two end pads, and `XZ` autoroutes the centre line there.

- An automatic leg runs the maze with a track `2w + g` wide, with the copper of both nets as its own, so neither pad row blocks it.
- Once every leg is routed, the whole centre line is offset by `(w + g) / 2` to each side, section by section between layer changes: a bend too tight for the pitch is cut, and a U turn narrower than the pitch fails.
- Before it is offset, an automatic leg's knees shorter than half the pitch and turns over 135 degrees are cut where the straight line is free; a vertex you drew is never moved.
- When P and N would come closer than the gap, a via pair of an automatic leg moves along the line, and an end reached at a slant gets a square approach; when nothing works the pair is a `route-failed` that names the point and the copper of another net nearest it.
- P runs on the side its start pad is on. When the end pads sit the other way round, the tracks would have to cross: that is a `route-failed` at the end. Where the directions at both ends are known before routing, from a stub or a manual command square to the pads, it is reported at once and the pair is not routed; swap at a via pair with `.cross()`, see Vias.
- Once its centre line is complete, the pair is laid out and its two tracks, fans, flares and via pairs stand as copper for the legs routed after it, so a via of another route cannot land on a fan wider than the centre line. When the final layout differs, the legs of its priority or lower that now collide with it route again.
- The two tracks carry `Track.pair`, `pair:<n>` in document order, `Track.role`, `P` or `N`, and `Track.route`. `board.pairs` lists every pair with its nets, width, gap and limits.

## Width, gap and impedance

| Value | Taken from, first that is set |
| --- | --- |
| width | `.width()`, solved by `.impedance()`, the class `width`, solved by the class `impedance`, the rules' `minTrackWidth` |
| gap | `.gap()`, the class `gap`, solved by `.impedance()` or the class `impedance`, the width |
| skew tolerance | `.skew()`, the class `skew`, 0.1 mm |
| uncoupled limit | the class `uncoupled`, 5 mm |

- `.impedance(ohms)` is the differential impedance of the pair on its start layer, from the board's stackup; a thick board solves wide and the pair necks down at its pads. It holds the gap of `.gap()` or the class and solves the width; with `.width()` it solves the gap; with neither both, the gap equal to the width, to 0.01 mm. stackup-and-rules.md has the model.
- A class `impedance` does the same for a pair that sets neither width nor impedance itself.
- On a single route `.impedance(ohms)` is the single ended impedance: it sets the width for the start layer unless `.width()` is given.
- Between the tracks and vias of one pair the gap governs, not a larger class clearance, so a class with `clearance: 0.2` and `gap: 0.15` lays out; `pair-gap` checks the gap. The rules' clearance still applies, and pads keep the class clearance.

## Vias

`@<layer>` in the path, or a layer change of an automatic leg, places a via pair: two vias, one per net, on the line across the run, or across the bisector at a bend.

- They are `max(w + g, size + c)` apart centre to centre, where `c` is the largest of the pair's clearance between its two nets, `minHoleToHole` from drill to drill and `holeClearance` from each hole to the other via.
- When that is wider than the pitch, the tracks flare out before the vias and back after them, each flare meeting its straight run at one vertex and ending on the via centre.
- The via is the route's via: `.vias({ drill, size })`, the class `via`, else the default via.
- `.cross(layer)` places a crossover: a via pair after which P and N run on swapped sides on `layer`. Both vias sit on the side the incoming P runs on, flared out to keep the clearance, N's a little further along; N crosses over on the first layer past P's via, P on the second ahead of N's. It needs a manual command before it. A USB 2.0 pair mirrored at its receptacle swaps right there: `route([J1.DP, J1.DN]).v(1.5).cross('B.Cu').X([U1.DP, U1.DN])`.

## Corners

Every corner you draw in the path is rounded on the centre line with an arc of radius `w + g`, the pitch, so the two tracks turn as concentric arcs a pitch apart.

- A rounded bend leaves the outer track longer by `2h` times the turn, `h` the half pitch; turns that add up to nothing leave no skew.
- Where the segments are too short for the radius, or the inner track's arc would meet other copper, the radius shrinks to the track width, never below the half pitch, then the corner is a 45 degree chamfer, else square.
- The corners of automatic legs stay as the router left them. `.corner(r)` sets the radius, `.corner('none')` keeps corners square, the class `corner: { radius }` sets it for a class.
- `Track.prims` keeps the arcs for the Gerbers, `Track.pts` has them flattened; lengths run along the arcs.

## Ends

An automatic leg at an end of the pair starts or ends with a straight stub out of the two end positions, a manual first or last command sets that direction itself. The stub tries square to the line through the positions, away from their footprint's centre, then the other way, then along that line, then the eight compass directions nearest the other end first, for staggered pads. A direction is taken when both tracks are free along the stub at their neck width and the centre line at its end; the stub runs a pitch past the pads and their fans, then on by up to the neck length until the centre line is free.

## Fans and uncoupled length

At each end both tracks run straight from the pad centres along the centre line to the far edge of both pads, so in staggered rows the nearer pad's track runs past the other pad, then fan to the pitch and join the coupled track at one vertex: the first point that a fan of 45 degrees or shallower reaches and that turns the track by 45 degrees at most. Pads further apart than the pitch fan in, pads closer fan out; tracks that fan out run straight on first until their fans clear the pads beside them.

- A fan shorter than a track width runs shallower and longer instead, so no fan is a step in the copper.
- At a bend right past the pads, the outer track may leave at up to 67.5 degrees.
- The uncoupled length is that of the fans and flares, both tracks, and of the stretch one track runs before the other joins. A 2.54 mm header fans a long way: raise the class `uncoupled` for it.

## Neck-down

A pair whose width does not fit its pads necks down like a single route, see routing.md, until its full width clears the pads beside it and its partner by one clearance. The neck is its own track, in line with the rest, and not coupled: `pair-gap` skips it.

## DRC

| Rule | Severity | Fires when |
| --- | --- | --- |
| `pair-gap` | error | a coupled section of a pair is more than 0.01 mm off the pair gap, edge to edge |
| `pair-skew` | error | the two tracks differ in length, via barrels included, by more than the skew tolerance, after skew tuning |
| `pair-uncoupled` | warning | the uncoupled length at the ends and the vias exceeds the class `uncoupled` |

- `pair-gap` skips what is not coupled: a segment to a pad or via centre, the fan after a pad's straight run, a neck and the chords of an arc.
- Lengths are `routeLength`: the tracks of each side along their arcs plus each via's distance through the board.
- `pcbjs inspect <entry> <net>` prints the pair of a net: its partner, width, gap, lengths, skew and uncoupled length.

## Skew tuning

Once the pair is laid out, a skew over the tolerance, from a bend or a fan, is tuned: the shorter track gets a bump on its side away from its partner, in its longest coupled run with room, by the difference.

- The bump is a U with corners of radius `w + g` down to the track width, at least `w + g + 0.02` mm high so its top never reads as coupled; in tight room its corners are chamfers.
- A U bump adds at least `2 pi - 4` times the track width, about 2.3 widths, 0.39 mm at 0.17 mm. A smaller skew is left, unless that smallest bump overshoots it by no more than the skew tolerance, and `pair-skew` names that floor instead of the room.
- The bump and the stretch of the partner beside it count as uncoupled length.
- Skew is tuned after lengths, clear of courtyards and silk labels. A pair with no room keeps its `pair-skew` finding, which says why. `.length()` and `.match()` on a pair measure its longer track.

## Length

A pair with `.length()` short of its target, or in a `.match()` group, also one mixed with single routes, is lengthened by meanders in its centre line, so both tracks grow alike and stay coupled. Each step takes the longest stretch of the centre line with room for a meander of the pair's full width on one side, then lays the pair out again and measures it.

- The bumps are U bumps in the centre line, rounded by the pitch down to the track width, never below the half pitch, so both tracks bump as concentric arcs. A bump adds at least `2 pi - 4` times its radius, 0.39 mm for 0.17 mm tracks at a 0.15 mm gap; a smaller leftover grows the last meander, or is left when the smallest bump would overshoot.
- So a pair cannot be tuned by less than that floor: a match tolerance tighter than the floor needs the paths evened out by hand. The `length` and `length-match` findings name the floor when what is missing is below it.
- The amplitude, targets, groups and the room, clear of courtyards and silk labels, are as for single routes, see length.md. `--lengths` and `board.routes` show what tuning added and, for a pair that stayed short, how much is missing and why.

## Limits

- A pair with a leg that failed, or whose centre line cannot carry it, places no copper at all; its nets stay unconnected.
- The router does not keep two via pairs of one route apart beyond the hole rules, so two layer changes close together can crowd the tracks between them. Place such vias with `@` in the path.
- A custom `RouteFn` gets the centre line request, with `pair: { partner, width, gap }` set and `width` the width of the centre line.
