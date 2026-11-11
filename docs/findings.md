# Findings: DRC and ERC

Every DRC and ERC rule name with its severity and one line on when it fires, and what makes a board orderable.
Advanced. The rule values these checks read and their overrides are in rules.md; how findings print is in check.md.

```
error    unconnected  at (9.41, 6.23)  net:GND, J1/1, D1/1  pcb.tsx:13:5: net GND is not fully connected, from J1/1 at (3.00, 4.96) to D1/1 at (15.83, 7.50)  drc:unconnected:3f2a9c0b71de
```

DRC and ERC run when compilation reaches the checks stage. Live sketches and partial compiles do not establish fresh check results; use Check for a complete validation. A finding has a rule, a severity, refs, a message, a position and usually a layer, an exact id at the end of its line and a fingerprint in `--json`. `info` never counts against a board.

During a live rebuild, manual geometry can appear before the solvers and checks finish. Earlier findings, BOM and bundled fabrication downloads are unavailable while their facets lag behind the geometry shown; the UI says checks or fabrication are pending. In a live session, Build fab requests a complete current-source build before downloading. A manual preview does not establish DRC/ERC success or an orderable build.

Finding preview surfaces show concise rule names and structured context such as references and coordinates. Full diagnostic messages never render in 2D, 3D or schematic views, their finding lists, selected chips, hover labels or native titles. Full explanations are available only in the HTML details pane.

The Checks viewer stays open as canonical focus changes. Previous and Next step through findings without wrapping; the list supports Up, Down, Home and End. Tab enters the current row, then moves on to the details. A newly focused finding starts at the top of its details and reveals its list row without stealing keyboard focus. Entity buttons support Enter or Space even when diagnostic text is selected.

## Identity and evidence

```ts
import type { Finding } from '@pcbjs/core/finding'
```

| Field | What |
| --- | --- |
| `id` | exact within one compile: `drc:<rule>:` or `erc:<rule>:` and 12 hex over board, target, rule, layer, the sorted uids of its items, refs for an ERC finding without items, `at` to 0.01 mm and `measured` to 1 µm; `inspect drc:…` prints it |
| `fingerprint` | 16 hex over board, target, layer, rule and the sorted refs but `route:<n>`, no position: the same finding across edits, not unique |
| `refs` | what it concerns in the grammar of refs.md: a pad `R201/2`, a part, `pair:1`, each item's, then the route and the net it concerns, `route:3`, `net:VCC` |
| `items` | the uids of the items the check named |
| `measured`, `required` | `{ value, unit }`, unit `mm`, `mm2`, `deg`, `ohm`, `ps`, `A` or `count` |
| `witness` | the geometry that shows it: the closest point pair for `clearance` and `short`, the track for `track-width`, the ratsnest line for `unconnected`, the failed leg's ends for `route-failed`, overlap rings for `courtyard` and the edge rules, the tracks for `length` and `pair-skew` |
| `provenance` | the levels that set the required value, the winner first: `{ rule, value, from, name?, to? }`, `from` a `pad` or `part` override, a `class` or the `rules`, `to` the kind a scoped clearance holds toward |
| `src` | ranges of the project, `{ file, start, end, role }`: the `item`, the `part` placement, or for a route made in a helper the `call` site then the route call |
| `args` | the rest of what the rule's message template reads |
| `message` | the rule's template over `measured`, `required`, `provenance`, `layer` and `args`; a plugin check's rule keeps the message it gives |
| `route` | the route it concerns, as inspect --lengths names it |
| `mark` | where views and `shot` draw it: a dot `{ at, layer, side }`, a line `{ line, rats, layer }`, `rats` its ratsnest index, null for a failed leg's own, or null |

- `check --watch` and a session match two compiles' findings by fingerprint, then the nearest `at` among the same fingerprint, for new, fixed and unchanged. An id held from an older compile resolves through its fingerprint.
- The viewer focuses a finding by its id, from a row, its dot or line, `?select=drc:…` or `pcbjs:finding`, and the VS Code Findings tree keys rows by id; both find a held one again by fingerprint, then nearest `at`. The site data holds these rows with `path`, its parts' instance paths.
- Messages name a pad as refs do, `pad R1/2`.
- Views and `pcbjs shot` draw a finding by its `mark`: a dot on its layer, an ERC one on the pad or part its refs name, or the ratsnest line of its net its witness lies on, `unconnected` among them, or a failed leg, labelled at its middle, viewer.md. An `unconnected` finding is labelled, there and in the findings list, by a broken-link icon and its net.
- An unbound route's number, `route:3` in refs, is in no fingerprint, so a route inserted above moves no fingerprint.

## DRC

| Rule | Severity | Fires when |
| --- | --- | --- |
| `short` | error | copper of two nets touches, or netless copper touches other copper |
| `clearance` | error | two nets are closer than their clearance, see rules.md Overrides; names an override that set it |
| `track-width` | error | a track is under `minTrackWidth` or a part's `trackWidth` |
| `current-width` | error | a width of a route with `.current()` is under what IPC-2152 wants for its current and copper, routing.md |
| `edge-clearance` | error | copper other than zones is within `edgeClearance` of the outline |
| `via-drill` | error | a via drill is under `minViaDrill` |
| `via-size` | error | a via diameter is under `minViaDiameter` |
| `annular-ring` | error | a via ring is under `minAnnularRing`, or copper around any part of a plated hole or slot is under `minPadAnnularRing`, accounting for pad shape and rotation |
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
| `fab-mismatch` | error | an expected copper or outline Gerber is missing, unreadable, has no closed outline, or differs from the board; `pcbjs build` and `check --fab` only, see fab-set.md |
| `single-pad` | warning | a net has one pad |
| `thermal-spokes` | warning | a pad joins a pour through fewer than `thermal.minSpokes` spokes reaching fill, after other directions were tried, counting its net's tracks and vias on that layer; pours.md Thermal reliefs |
| `thermal-spoke-width` | warning | a pour's spokes are narrower than its min width; they are kept |
| `teardrop-dropped` | info | a teardrop breaks a clearance even at half size and is left out; route-options.md Teardrops |
| `net-loop` | warning | a net's copper, pours left out, closes a loop through a layer or vias and plated pads; names the net, segments and a hand chain's source; silenced by `.loop()` or the class `loops: true`; a pin strap inside one courtyard is not reported; autorouter.md Joins and loops |
| `trunk-narrow` | info | a joining leg could not widen the thinner trunk it met |
| `stitch-empty` | info | a `stitch()` placed no via: no fill on a listed layer or no room; pours.md |
| `follow-unrouted` | warning | the route an `at:follow` part follows has no copper, so the part stays where it was drawn; placement.md |
| `patch-stale` | warning | a patch's target is gone or hashes otherwise; the patch is skipped, patches.md |

- Connectivity is copper overlap per layer: pads, tracks, vias, each zone fill piece and copper graphics with a net; a thermal pad reaches the fill only through its spokes. Missing connections are the ratsnest and the `unconnected` count.
- Same-net copper needs no clearance. A pair's gap replaces a larger class clearance between its own tracks and vias, never below `clearance`. `itemClearance(board, a, b)` in `packages/compile/src/netclass.ts` gives the value.
- Silk checks read graphics and text strokes at their thickness; silk text is raised to `silkMinWidth`, so `silk-width` only guards it.
- `silk-over-pad` stops at the mask opening; the wider `silkToPad` is listed in README-fab, not enforced. Silk that only touches the edge passes `silk-over-edge`.
- Fill and router keep `holeClearance` from holes of other nets and routed vias keep `minHoleToHole`, so their copper passes. DRC uses a spatial grid.

## ERC

| Rule | Severity | Fires when |
| --- | --- | --- |
| `unconnected-pin` | warning | a pin of a connected part has no connection and no `NC` |
| `single-pin-net` | warning | a `Net` on the board reaches fewer than two pins |
| `net-class` | warning | a net has two classes, or a class missing from a board that defines classes |
| `impedance-width` | warning | a solved impedance width is over twice the start pad's smaller side, see stackup-and-rules.md |
| `unsourced-part` | warning | a BOM row has no part number, with `requireSourcing: true` |
| `unsourced-target` | warning | the board has sourcing tags and a row has only `MPN:<tag>` keys for other tags |
| `copper-weight` | warning | a layer over 1 oz with `clearance` or `minTrackWidth` below the fab's figure, `COPPER_WEIGHT_RULES` of the base rules |
| `silk-ref` | warning | a silk ref finds no spot within 3 mm of its courtyard and is left out; layout.md Silk refs |
| `silk-ref-hidden` | info | refs of parts too small for their label are left out; names the parts |
| `model-missing` | warning | a footprint's `model` STEP file is missing, see 3d.md |
| `sch-short`, `sch-missing-symbol`, `sch-unwired`, `sch-dangling`, `sch-overlap` | error, warnings | the schematic drawing, `layer: 'sch'` and `at` in sheet mm; schematic-graphic.md |

## Orderable

No DRC errors, no ERC errors and nothing unconnected: README-fab starts with `STATUS: ORDERABLE`, else `pcbjs build` and `pcbjs check` exit 1. Warnings do not block.
