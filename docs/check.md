# Check

The commands of the edit loop, `check`, `inspect`, `dev` and `build`, how to read what `pcbjs check` prints, exit codes and where files land.
Basic. Every other command and flag is in cli.md, the `--json` report too.

```sh
npx pcbjs check            # compile, route, DRC and ERC of the entries, no files; exit 1 on errors
npx pcbjs check --watch    # recompile on save, print new and fixed findings
npx pcbjs inspect R1       # where the first board's resistor pads ended up, in absolute mm; inspect.md
npm run dev                # the live viewer on http://localhost:5173
npm run build              # after check passes: fab set and site, with DRC/ERC and Gerber self-check
```

## Reading the output

A board whose LED route is walled off by a keepout:

```
Probe  pcb.tsx  3 footprints, 6 pads, 1 track, 0 vias, 0 zones, 3 nets  DRC 3 errors, 0 warnings, 2 unconnected  ERC ok  FAIL  254 ms: route 45 ms, zones 1 ms, connectivity 1 ms, drc 4 ms, erc 8 ms
  routing 1 leg, 0 routed, 1 failed, 0 cached, 0 held, 0 ripped, 0 rounds
  DRC route-failed: 1 error
    error    route-failed  F.Cu  at (12.00, 7.50)  R1/1, D1/1, net:VCC, J1/2, J1/1, route:2, net:LED  pcb.tsx:17:6: cannot route net LED from (9.825, 7.5) on F.Cu to (14.175, 7.5) on F.Cu, layers F.Cu, B.Cu: no path within maxDetour: every way is longer than 14.35 mm, for 4.35 mm between its ends; blocked by the keepout (pcb.tsx:15:6) on F.Cu, B.Cu; nearest obstacles: pad R1/1 (VCC), pad D1/1 (GND), track (VCC) (pcb.tsx:16:27), pad J1/2 (VCC), pad J1/1 (GND)  drc:route-failed:7c1e0f42b9a3
  DRC unconnected: 2 errors
    error    unconnected  at (9.41, 6.23)  net:GND, J1/1, D1/1  pcb.tsx:13:5: net GND is not fully connected, from J1/1 at (3.00, 4.96) to D1/1 at (15.83, 7.50)  drc:unconnected:3f2a9c0b71de
    error    unconnected  LED: net LED is not fully connected: route route:2 failed, see route-failed
FAIL  DRC 3 errors, 0 warnings, 2 unconnected  ERC 0 errors, 0 warnings
```

- The board line: name, rev and `[target]` of a board with variants; entry; counts; `DRC ok` or its counts; `ERC ok` or its counts; `FAIL` when not orderable; compile time and phases.
- The routing line counts the autorouter legs: routed, failed, reused from the cache, held by patches, then the legs negotiation took off the board and its rounds; shared routing adds `shared rules: …`, autorouter.md.
- Then the findings by rule, the one that explains the next first: `route-failed`, `short`, `clearance`, `hole-to-copper`, other errors, warnings, `unconnected`. Identical lines print once with `xN`, at most 10 per rule, then `and N more <rule>`.
- The last line is the total over every board, with `N entries failed to compile` when some did.

A finding line, field by field:

| Field | Here | Meaning |
| --- | --- | --- |
| severity | `error` | `error` blocks ordering, `warning` and `info` do not |
| rule | `route-failed` | the DRC rule; ERC rules print as `ERC <rule>`; findings.md lists every one |
| layer | `F.Cu` | when the finding has one |
| position | `at (12.00, 7.50)` | board mm, x right, y down |
| refs | `R1/1, …, net:LED` | what it concerns, refs.md; `pcbjs inspect` takes each |
| route | `route:3` | the route its copper belongs to when its refs name none, as `pcbjs inspect --lengths` lists it |
| source | `pcb.tsx:17:6` | the line to edit: the route call, the placement or the item; a route made in a helper reads `pcb.tsx:40:5 via lib/fan.tsx:12:5`, the call site first |
| message | after `: ` | measured and required values, or for a route its ends, the layers tried, a keepout that walls it off and the nearest obstacles |
| id | `drc:route-failed:7c1e…` | exact in this compile; `--json` adds the fingerprint edits keep, findings.md |

- A line only some targets have names them before the id, `[JLCPCB 2-Layer, House]`.
- Unless `--verbose`, the `unconnected` findings of a net with a `route-failed` fold into one line, and three or more of one rule on one footprint into `56 findings on J2, the first at (x, y) on F.Cu: <message>`.
- A `route-failed` names the nearest obstacles: move a part, add an `X x y` waypoint, raise the route's `.priority()` or allow more layers, autorouter.md.
- A compile error prints `<entry>  compile error: <file:line:col>: <message>` for the board line.
- With a `tsconfig.json`, `check` then type-checks the entries, cached in `.pcbjs/typecheck.json`: `typecheck  ok  450 ms`, or each error as `error    typecheck  pcb.tsx:12:5: TS2345 <message>`, the innermost reason of tsc's chain, the whole chain with `--verbose`.
- `--verbose` adds a line per stage, `  stage  autoroute  10 ms` or `hit`; `--cache` adds a line per cached stage or unit, `  cache  autoroute  hit   06082bae8151` or `  cache  checks:silk  miss  41c0e2a9d3b7`, design.md.

`build` compiles and runs DRC, ERC and the Gerber self-check, then prints `fab    .pcbjs/fab  6 sets, 94 files` and `site   .pcbjs/dist  4 boards, 6 entries, 8 pages  2.8 s`. It does not run TypeScript checking; run `pcbjs check` successfully before building files for manufacture.

## Exit codes

0 when every board compiled and is orderable, with no type errors for `check`. 1 on a DRC or ERC error, an unconnected net, a compile error, a type error from `check`, an unknown `inspect` query or `q` reference, a failed `shot`, script or test, or a usage error; warnings never. 2 when `q` names several, 3 for `events` without a session, 124 when `events --wait` or a script times out. `build` still writes every file it can.

## Stale outputs

A failed entry keeps its last build outputs: the board JSON gets `stale: true` and `staleError`, its fab directories a `STALE` file, the build prints `stale  <paths>` and exits with code 1. The dev server keeps the last good board, marked stale.

## Where files land

Everything under `.pcbjs/` is generated; never edit it.

| Path | What |
| --- | --- |
| `.pcbjs/fab/<board>/` | the fab set: Gerbers, drills, `bom.csv`, `cpl.csv`, `<board>.pcb.svg`, `README-fab.txt`, the zip; fab-set.md |
| `.pcbjs/dist/` | the static site; `boards/<board>.json` is the full model, large: ask `pcbjs inspect` instead |
| `.pcbjs/cache/` | stage outputs, the route memos in `route/<board>.json`, references and Vite's; `--fresh` rebuilds, design.md |
| `.pcbjs/dev.json`, `session`, `log/` | the running session, session.md |
| `.pcbjs/test/`, `.pcbjs/shots/` | the boards of `pcbjs test`; the PNGs of `pcbjs shot` |
