# Findings: DRC and ERC

Every DRC and ERC rule name with its severity and one line on when it fires, and what makes a board orderable.
The rule values these checks read and their overrides are in rules.md; how findings print is in cli.md.

## DRC

DRC runs on every compile. Each finding has a rule, a severity, error, warning or info, the last never counting against a board, a message with the measured and required values, a position and usually a layer. cli.md shows how findings print.

| Rule | Severity | Fires when |
| --- | --- | --- |
| `short` | error | copper of two nets touches, or copper with no net touches other copper |
| `clearance` | error | copper of two nets is closer than the clearance of the pair, see rules.md Overrides; names an override that set it |
| `track-width` | error | a track is narrower than `minTrackWidth`, or a part's `trackWidth` |
| `edge-clearance` | error | copper other than zones is closer than `edgeClearance` to the outline |
| `via-drill` | error | a via drill is below `minViaDrill` |
| `via-size` | error | a via diameter is below `minViaDiameter` |
| `annular-ring` | error | a via ring is below `minAnnularRing`, or a plated pad ring below `minPadAnnularRing` |
| `drill` | error | a pad drill, or a via drill that passed `via-drill`, is below `minDrill` |
| `hole-to-hole` | error | two holes of any kind are closer than `minHoleToHole`, edge to edge |
| `hole-to-copper` | error | copper of another net or no net is closer than `holeClearance` to a hole edge |
| `unconnected` | error | a net is split into islands; one finding per missing connection, with both ends |
| `route-failed` | error | the autorouter could not route a leg, see autorouter.md |
| `keepout` | error | a track, via or pour fill of a kind a keepout forbids is inside it |
| `pour-in-keepout` | warning | a keepout that forbids pours leaves a pour with no fill; see layout.md Keepouts |
| `pair-gap` | error | a coupled section of a differential pair is more than 0.01 mm off the pair gap; see pairs.md |
| `pair-skew` | error | the two tracks of a pair differ in length by more than its skew tolerance, 0.1 mm by default, after tuning; see pairs.md |
| `pair-uncoupled` | warning | the uncoupled length of a pair exceeds the class `uncoupled`, 5 mm by default |
| `length` | error | a route with `.length()` is outside its range after tuning, see length.md |
| `length-match` | error | the routes of a `.match()` group spread wider than its tolerance after tuning, see length.md |
| `silk-width` | warning | a silkscreen graphic or text is thinner than `silkMinWidth` |
| `silk-over-pad` | warning | a silkscreen stroke runs into a mask opening on the same side |
| `mask-web` | warning | the solder mask between two pad openings is narrower than `maskWeb`, one finding per part for pads of one part, see rules.md Mask web |
| `silk-over-edge` | warning | silkscreen ink runs past the outline or into a cutout |
| `edge-courtyard` | error | the courtyard of a part is within the `edge` band, see rules.md Edge band |
| `edge-silk` | error | silkscreen ink is within the `edge` band |
| `edge-pad` | error | a pad is within the `edge` band |
| `courtyard` | warning | the courtyards of two footprints overlap by 10 µm or more; a shallower overlap passes, as in KiCad |
| `outline` | warning | `Edge.Cuts` does not form a closed outline |
| `cutout-outside` | error | an `Edge.Cuts` ring other than the outline, the largest ring, crosses it or lies off the board |
| `reference-mate` | error | a pad of a referenced board's mating connector lands more than 0.1 mm from every pad of the local part, see references.md |
| `reference-net` | error | with `mate.nets`, a pad of the local mating part meets a remote pad of another net than the mapping wants |
| `reference-collision` | warning | a body or the slab of a referenced board reaches more than 0.1 mm into this board's slab or a part body, or into another reference's slab or body, its height from `height`, else the model box |
| `fab-mismatch` | error | a copper or outline Gerber read back differs from the board; only from `pcbjs build` and `check --fab`, see fab-set.md |
| `single-pad` | warning | a net has only one pad |
| `thermal-spokes` | warning | a pad joins a pour through fewer than `thermal.minSpokes` spokes that reach its fill, after the other directions were tried, counting the tracks and vias of its net that join it on that layer; see pours.md Thermal reliefs |
| `thermal-spoke-width` | warning | a pour's thermal spokes are narrower than its min width; they are kept |
| `teardrop-dropped` | info | a teardrop would come within the clearance of other copper, a hole, the edge or a keepout even at half size, so it is left out; see routing.md Teardrops |
| `net-loop` | warning | the copper of a net, pours left out, closes a loop: a hole in a layer's copper or a cycle through vias and plated pads; names the net and the segments, with the source of a hand chain; `.loop()` on a route of the net or `loops: true` in its class silences it; a pin strap, a loop whose edges all lie in one part's courtyard and that meets no pad of another part, is not reported; see autorouter.md Joins and loops |
| `trunk-narrow` | info | a joining leg could not widen the thinner trunk it met without breaking a clearance, so it ran to its pad, or joined and left the trunk thin; see autorouter.md Joins and loops |
| `stitch-empty` | info | a `stitch()` call placed no via: the net has no fill on a listed layer, or no lattice point has room; see pours.md |

- Connectivity is computed from copper overlap per layer: pads, tracks, vias, each piece of a zone fill, and copper graphics with a net; a thermal pad overlaps the fill only through its spokes. The missing connections are the ratsnest and the `unconnected` findings, counted in the summary.
- The clearance per pair of items is set as in rules.md Overrides; same-net copper needs none, and the autorouter and the zone fill keep it. Between the tracks and vias of a differential pair the pair gap replaces a larger class clearance, never below `clearance`, see pairs.md. `itemClearance(board, a, b)` in `packages/compile/src/netclass.ts` gives the value.
- DRC and connectivity use a spatial grid, so their time grows with the number of nearby pairs.

## ERC

ERC runs on every compile, next to DRC, with findings of the same shape.

| Rule | Severity | Fires when |
| --- | --- | --- |
| `unplaced-part` | error | a part declared at module level, in a file that placed parts here, is never placed |
| `unplaced-circuit` | error | a circuit instance on this board has no layout and no part placed |
| `unconnected-pin` | warning | a pin of a placed part has no connection and no `NC` |
| `single-pin-net` | warning | a `Net` used on the board reaches fewer than two pins |
| `net-class` | warning | a net is declared with two classes, or its class is missing from a board that defines classes |
| `impedance-width` | warning | a width solved from an impedance is over twice the smaller side of the start pad, see stackup-and-rules.md |
| `unsourced-part` | warning | a BOM row has no part number, with `requireSourcing: true` |
| `unsourced-target` | warning | the board has sourcing tags and a BOM row has only `MPN:<tag>` keys for other tags |
| `copper-weight` | warning | a copper layer is heavier than 1 oz and `clearance` or `minTrackWidth` is below the fab's figure for that weight, `COPPER_WEIGHT_RULES` in `@pcbjs/core/rules` |
| `silk-ref` | warning | a part's silk ref has no clear spot within 3 mm of its courtyard and is left out, see layout.md Silk refs |
| `silk-ref-hidden` | info | silk refs of parts too small to hold their label found no spot round them and are left out; names the parts, see layout.md Silk refs |
| `model-missing` | warning | the STEP file of a footprint's `model` is not there, see 3d.md |
| `sch-short`, `sch-missing-symbol`, `sch-unwired`, `sch-dangling`, `sch-overlap` | error, warnings | the schematic drawing, `layer: 'sch'` and `at` in sheet mm, see schematic-graphic.md |

## Notes on the checks

- The silk checks look at graphics and at text strokes at their thickness. Silk text is raised to `silkMinWidth` when laid out, so `silk-width` is only a guard for it.
- `silk-over-pad` stops at the mask opening, which the fab clips silk off anyway; the wider `silkToPad` is listed in README-fab, not enforced.
- `silk-over-edge` measures how far silk ink runs past the outline or into a cutout; ink that only touches the edge passes.
- The zone fill and the router keep `holeClearance` around every hole of another net, so their copper passes `hole-to-copper`; routed vias also keep `minHoleToHole` from every hole.

## Orderable

A board is orderable when it has no DRC errors, no ERC errors and nothing unconnected. README-fab then starts with `STATUS: ORDERABLE`. `pcbjs build` and `pcbjs check` exit with code 1 otherwise. Warnings do not block.
