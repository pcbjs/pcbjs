---
name: pcbjs-best-practices
description: Techniques that proved out on real pcbjs boards. Use when improving, hardening or reviewing a pcbjs board beyond a clean check, when turning a spec, rule sheet or check script into DRC rules, when measuring copper, lengths or clearances, when stacking boards with reference() and mates, choosing between hand routes and the autorouter, sourcing 3D models from vendors, or proving a change with cold and warm checks.
---

# pcbjs best practices

These are the habits that held up when generated KiCad boards were moved to pcbjs and then improved past their originals. Each one makes a requirement checked on every compile instead of remembered, or makes a change measured instead of guessed. Read the reference for the topic at hand; each has compiling examples.

## Principles

1. **A rule belongs in DRC, not in a script.** If a spec says it, find the pcbjs rule that says it: an `edge` band, `maskWeb`, sided `holeClearance`, `minHoleToHole` by kind, clearance by the other item's kind, a keepout for a layer convention, `mate.nets` for a cable pinout. A script only for what no rule can say. references/rules-as-drc.md.
2. **Prove a rule bites.** A typo in a kind key or an `except` list passes silently. Tighten each new rule by a step until DRC fires, note where it fires, then put it back. The margin you find is worth recording.
3. **House rules are the strictest of every fab you order from.** One module takes the maximum of the owner's sheet and each fab's published set, so every board is checked against all of them. references/house-rules.md.
4. **Measure with `inspect`, never by reading files.** `inspect <net>` gives copper per layer and pour pieces, `--lengths` every route, `--layer` every item with ink bounds, `--json` all of it for a contract script. references/measuring.md.
5. **Placement asserts become contracts over `inspect --json`.** A generator's asserts, an enclosure's walls, a via grid: one script, one compile, a clear list of violations. Probe it with a 0.1 mm move that DRC passes.
6. **Judge a change by a cold check, confirm it warm.** Delete `.pcbjs/routes`, check, then check again: same counts, same findings, same `inspect --lengths`, all legs cached. A warm pass alone can hide a routing change.
7. **Keep hand routes that encode a decision.** Try the router with a two-line trial and compare lengths and topology before replacing an owner's chain; a skew budget on hand routes is a `.match()` group. references/routing-choices.md.
8. **Boards that meet are checked together.** `reference()` with a `mate` on every connector pair, `nets` across each mate, real body heights, one shared pinout module and one shared frame module. references/stacks.md.
9. **Copper for current and heat is measured.** Dead pour pockets become heat copper with thermal vias; `stitch()` places stitching vias from the fill; `inspect <net>` reports the area before and after. references/copper.md.
10. **Models come from the vendor first, with the licence noted.** `pcbjs model add`, `model align`, `model check` and a 3D shot; a model whose licence forbids redistribution is fetched by a make target and kept out of git. references/models.md.
11. **The fab set is reproducible and self-explaining.** `fabNotes` for order choices, teardrops on through-hole pads, NewStroke for KiCad-looking legends, `thicken` for variable outline text, and a build date from the design's last commit. references/fab-output.md.
12. **Compare against the original while you improve.** A netlist and copper comparison that lists the differences you made on purpose, each with its reason, and fails on anything else. references/comparisons.md.

## How to work a change

- One improvement per commit, each with its numbers: what it checks or changes, the before and after, and the probe that shows it bites.
- Do not change the owner's design decisions, such as connector positions, the circuit, a routing style or a hole density, to make a number better. Write those as proposals instead.
- Write down techniques you considered and did not take, one line each with the reason, so the next pass does not redo the analysis.
- When pcbjs cannot express something, keep the workaround small and named, with a comment that says which feature would replace it.

## Save tokens

- Never lint or format by hand; the commit hook does it.
- Never read `dist` or `board.json`; `pcbjs check` gives the findings and `pcbjs inspect` the positions, nets and lengths.
- Run only the test suite of the package you changed, unless the change crosses packages.
- Run `pcbjs shot` to look at a board instead of opening a browser.

## Checklist before calling a board done

- `pcbjs check --fab` cold and warm, identical; `STATUS: ORDERABLE` in README-fab.
- `pcbjs model check` 0 flagged; `pcbjs shot --view both` looked at, `--flip` for back parts.
- Every spec rule either in DRC, in a contract script, or listed as not covered with the reason.
- Two `pcbjs build --date <iso>` runs give byte-identical fab sets.
