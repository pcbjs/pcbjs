# Findings: DRC and ERC

Every DRC and ERC rule name with its severity and one line on when it fires, and what makes a board orderable.
The rule values these checks read and their overrides are in rules.md; how findings print is in cli.md.

```
error    unconnected  at (9.41, 6.23)  J1, D1  pcb.tsx:13:5: net GND is not fully connected, from J1.1 at (3.00, 4.96) to D1.1 at (15.83, 7.50)
```

DRC and ERC run on every compile. A finding has a rule, a severity, a message with measured and required values, a position and usually a layer. `info` never counts against a board.

## DRC

| Rule | Severity | Fires when |
| --- | --- | --- |
| `short` | error | copper of two nets touches, or netless copper touches other copper |
| `clearance` | error | two nets are closer than their clearance, see rules.md Overrides; names an override that set it |
| `track-width` | error | a track is under `minTrackWidth` or a part's `trackWidth` |
| `edge-clearance` | error | copper other than zones is within `edgeClearance` of the outline |
| `via-drill` | error | a via drill is under `minViaDrill` |
| `via-size` | error | a via diameter is under `minViaDiameter` |
| `annular-ring` | error | a via ring is under `minAnnularRing`, a plated pad ring under `minPadAnnularRing` |
| `drill` | error | a pad drill, or a via drill that passed `via-drill`, is under `minDrill` |
| `hole-to-hole` | error | two holes are closer than `minHoleToHole`, edge to edge |
| `hole-to-copper` | error | other or netless copper is within `holeClearance` of a hole edge |
| `unconnected` | error | a net is split; one finding per missing connection, with both ends |
| `route-failed` | error | a leg could not be routed, see autorouter.md |
| `keepout` | error | a track, via or fill of a forbidden kind is inside a keepout |
| `pour-in-keepout` | warning | a keepout that forbids pours leaves a pour with no fill; layout.md Keepouts |
| `pair-gap` | error | a coupled section of a pair is more than 0.01 mm off its gap; pairs.md |
| `pair-skew` | error | a pair's tracks differ by more than its skew tolerance, 0.1 mm by default, after tuning |
| `pair-uncoupled` | warning | a pair's uncoupled length exceeds the class `uncoupled`, 5 mm by default |
| `length` | error | a `.length()` route is outside its range after tuning, see length.md |
| `length-match` | error | a `.match()` group spreads wider than its tolerance after tuning |
| `silk-width` | warning | silk graphic or text is thinner than `silkMinWidth` |
| `silk-over-pad` | warning | a silk stroke runs into a mask opening on its side |
| `mask-web` | warning | mask between two openings is under `maskWeb`, one finding per part for one part's pads; rules.md Mask web |
| `silk-over-edge` | warning | silk ink runs past the outline or into a cutout |
| `edge-courtyard` | error | a courtyard is within the `edge` band, see rules.md Edge band |
| `edge-silk` | error | silk ink is within the `edge` band |
| `edge-pad` | error | a pad is within the `edge` band |
| `courtyard` | warning | two courtyards overlap by 10 µm or more, as in KiCad |
| `outline` | warning | `Edge.Cuts` does not form a closed outline |
| `cutout-outside` | error | an `Edge.Cuts` ring other than the largest crosses it or lies off the board |
| `reference-mate` | error | a referenced board's mating pad lands over 0.1 mm from every local pad, see references.md |
| `reference-net` | error | with `mate.nets`, a local mating pad meets a remote pad of the wrong net |
| `reference-collision` | warning | a referenced body or slab reaches over 0.1 mm into this board's slab, a body or another reference, height from `height`, else the model box |
| `fab-mismatch` | error | a copper or outline Gerber read back differs from the board; `pcbjs build` and `check --fab` only, see fab-set.md |
| `single-pad` | warning | a net has one pad |
| `thermal-spokes` | warning | a pad joins a pour through fewer than `thermal.minSpokes` spokes reaching fill, after other directions were tried, counting its net's tracks and vias on that layer; pours.md Thermal reliefs |
| `thermal-spoke-width` | warning | a pour's spokes are narrower than its min width; they are kept |
| `teardrop-dropped` | info | a teardrop breaks a clearance even at half size and is left out; routing.md Teardrops |
| `net-loop` | warning | a net's copper, pours left out, closes a loop through a layer or vias and plated pads; names the net, segments and a hand chain's source; silenced by `.loop()` or the class `loops: true`; a pin strap inside one courtyard is not reported; autorouter.md Joins and loops |
| `trunk-narrow` | info | a joining leg could not widen the thinner trunk it met |
| `stitch-empty` | info | a `stitch()` placed no via: no fill on a listed layer or no room; pours.md |

- Connectivity is copper overlap per layer: pads, tracks, vias, each zone fill piece and copper graphics with a net; a thermal pad reaches the fill only through its spokes. Missing connections are the ratsnest and the `unconnected` count.
- Same-net copper needs no clearance. A pair's gap replaces a larger class clearance between its own tracks and vias, never below `clearance`. `itemClearance(board, a, b)` in `packages/compile/src/netclass.ts` gives the value.
- Silk checks read graphics and text strokes at their thickness; silk text is raised to `silkMinWidth`, so `silk-width` only guards it.
- `silk-over-pad` stops at the mask opening; the wider `silkToPad` is listed in README-fab, not enforced. Silk that only touches the edge passes `silk-over-edge`.
- Fill and router keep `holeClearance` from holes of other nets and routed vias keep `minHoleToHole`, so their copper passes. DRC uses a spatial grid.

## ERC

| Rule | Severity | Fires when |
| --- | --- | --- |
| `unplaced-part` | error | a module level part, in a file that placed parts here, is never placed |
| `unplaced-circuit` | error | a circuit instance has no layout and no part placed |
| `unconnected-pin` | warning | a placed part's pin has no connection and no `NC` |
| `single-pin-net` | warning | a `Net` on the board reaches fewer than two pins |
| `net-class` | warning | a net has two classes, or a class missing from a board that defines classes |
| `impedance-width` | warning | a solved impedance width is over twice the start pad's smaller side, see stackup-and-rules.md |
| `unsourced-part` | warning | a BOM row has no part number, with `requireSourcing: true` |
| `unsourced-target` | warning | the board has sourcing tags and a row has only `MPN:<tag>` keys for other tags |
| `copper-weight` | warning | a layer over 1 oz with `clearance` or `minTrackWidth` below the fab's figure, `COPPER_WEIGHT_RULES` in `@pcbjs/core/rules` |
| `silk-ref` | warning | a silk ref finds no spot within 3 mm of its courtyard and is left out; layout.md Silk refs |
| `silk-ref-hidden` | info | refs of parts too small for their label are left out; names the parts |
| `model-missing` | warning | a footprint's `model` STEP file is missing, see 3d.md |
| `sch-short`, `sch-missing-symbol`, `sch-unwired`, `sch-dangling`, `sch-overlap` | error, warnings | the schematic drawing, `layer: 'sch'` and `at` in sheet mm; schematic-graphic.md |

## Orderable

No DRC errors, no ERC errors and nothing unconnected: README-fab starts with `STATUS: ORDERABLE`, else `pcbjs build` and `pcbjs check` exit 1. Warnings do not block.
