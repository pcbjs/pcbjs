# Common findings and their fixes

The rules an agent meets most, with the usual cause and fix. `pcbjs docs findings` lists every rule; `pcbjs docs --grep <rule>` finds where a rule is explained. A board is orderable with no DRC error, no ERC error and nothing unconnected; warnings do not block, info never counts.

## DRC

| Rule | Usual cause | Fix |
| --- | --- | --- |
| `route-failed` | the leg has no way through: a keepout, a dense pad row, too few layers, a detour limit | add a waypoint `.X('x y')` into free board, allow `.layers([...])`, raise `.priority()`, move the obstacle named in the message, or draw part of the route by hand; then look at `pcbjs shot --select <ref>` |
| `unconnected` | a failed route, a pour piece cut off, a pad no spoke reaches | fix the `route-failed` it points to first; for a cut pour piece add a via or a short track; `pcbjs inspect <net>` lists the gaps |
| `short` | two nets touch: a manual track through a pad, two pours of one priority, a footprint with touching pads | move the track; give pours distinct `priority`; a net tie footprint needs `netTie` |
| `clearance` | manual copper too close to another net; the message names the override or class that set the value | move the copper, or set the right override on the part, pad or class; never lower the board rule to pass |
| `hole-to-copper`, `hole-to-hole` | a via or track near a drill | move it; the rules may be split by side, `holeClearance: { inner, outer }`, and by kind, `minHoleToHole: { pad, via }` |
| `edge-clearance` | copper near the outline | move it in, or `part.rules({ edgeClearance })` for an edge connector the fab allows |
| `keepout` | copper of a forbidden kind inside a keepout | route around it, or `except: [NET]` on the keepout for a net that may enter |
| `length`, `length-match` | no room for meanders, or a route already too long | a finding that names no room means a courtyard or silk label is in the way: move the label or part, or add a waypoint into free board |
| `net-loop` | a hand chain or a `.direct()` leg that crosses copper its net already has, two routes between the same pads | let one leg join instead: drop its waypoints so `route(a).X(b)` meets the trunk, or remove the second path; `.loop()` on a route of the net, or `loops: true` in its class, when the loop is meant |
| `thermal-spokes` | a pad reached by too few spokes | `thermal={{ 2: 'solid' }}` on the placement, a smaller `thermal.gap`, or `{ angle: 45 }` on that pad |
| `silk-over-pad`, `silk-over-edge`, `silk-width` | a label on a mask opening or past the edge, a thin stroke | move the label; set `refAt` for a ref; `thicken` on outline-font text |
| `courtyard` | two parts overlap | move one; inspect both with `pcbjs inspect A B` |
| `edge-courtyard`, `edge-silk`, `edge-pad` | an item inside the `edge` band | move it, or list the part in the band's `except` when it is meant to overhang |
| `mask-web` | two pad openings too close for the fab's dam | a gang opening drawn on the mask layer, or accept the merge as the warning says |
| `reference-mate`, `reference-net`, `reference-collision` | a mating connector misplaced, a pin with a different net, a body in the gap | see `pcbjs docs references`; `pcbjs inspect references` prints the stack |

## ERC

| Rule | Fix |
| --- | --- |
| `unconnected-pin` | connect the pin, or connect it to `NC` |
| `unplaced-part` | place the part or remove it |
| `single-pin-net` | a net reaching one pin is usually a typo in `.connect()` |
| `net-class` | add the class to `classes` on `<PCB>`, a preset or `defineDefaultBoard` |
| `model-missing` | the model path is relative to the file that holds the `model` literal |

## Typecheck

`pcbjs check` runs tsc on the entries when the project has a `tsconfig.json`; an error prints as `error typecheck pcb.tsx:12:5: TS2339 …` and exits 1. The usual one is a pin name that does not exist, or a pin list declared as `string[]` so no names are typed.

## Workflow

- Fix in rule order: the first group printed usually causes the later ones.
- After a fix, `pcbjs check` again; `--watch` prints only what changed.
- `pcbjs check --json r.json` gives every finding with a stable `id`, `rule`, `at`, `refs`, `src` and `route`, for a script.
- Never silence a finding by loosening a board rule. Use an override scoped to the part, pad, net or class that needs it, with a comment saying why.
