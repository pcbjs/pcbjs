# CLI

Every `pcbjs` command and flag, the output formats, the `--json` report, exit codes and stale outputs.
Run commands in the project directory; the entries come from `entries` in its pcb.config.ts.

## Commands

| Command | Does |
| --- | --- |
| `pcbjs check [entry...]` | compile, route, DRC and ERC, no files written |
| `pcbjs inspect [entry] [query...]` | positions of footprints, pads, nets, routes or one layer's items, see inspect.md |
| `pcbjs build [entry...]` | check, then write the fab sets and the static site |
| `pcbjs dev [entry...]` | dev server with the live viewer |
| `pcbjs dev --workspace <folder>...` | one dev server for every project under the folders, see workspace.md |
| `pcbjs preview [entry...]` | serve the built site |
| `pcbjs shot [entry...]` | PNG screenshots of the viewer in a headless Chrome |
| `pcbjs model <add\|align\|check\|fetch>` | 3D models, see models.md; `fetch` downloads the models parts name, see 3d.md |
| `pcbjs import <footprint\|board> <source>` | a KiCad footprint or `.kicad_pcb` as code, see import.md |
| `pcbjs docs [topic]` | print a topic of these docs |
| `pcbjs create <dir>` | a new project from the template, shaped by `--layers`, `--fab`, `--size` and `--outline`, or from an example board with `--example <name>`; `create --list-examples` names the examples |
| `pcbjs ide <install\|status>` | the bundled VS Code extension, see editor.md |
| `pcbjs skills <install\|list\|path>` | the agent skills of the `@pcbjs/skills` the project resolves: copies them into `.claude/skills` or `--to <dir>`, see skills.md |
| `pcbjs doctor` | the `@pcbjs` versions installed, Node, Chrome, the step converter, the cache format versions, the config and its entries; exit 1 when two packages differ in major.minor, which check, build and dev print as one warning |

An entry is a `.tsx` or `.ts` module that default-exports `<PCB>`. The entries are `entries` in the config, paths relative to it, globs allowed. Entries on the command line win for that run, with one line saying so. `inspect` takes the config's only entry, or the one named first. Two entries with the same board name are an error. `DEBUG=1` prints stack traces. `pcbjs -v, --version` prints one line, `pcbjs 0.1.0: @pcbjs/cli 0.1.0, @pcbjs/core 0.1.0, …`, the meta package's version and every `@pcbjs` package the project resolves, and `--help` starts with it; `pcbjs doctor` adds where each lives.

Any entry name works and nothing checks it; the recommended names are `pcb.tsx` for a single board and `<board>.pcb.tsx` beside `<board>.sch.tsx` for each of several, as in `examples/demo`, so editors, the file icons and readers recognise entries.

## Flags

| Flag | Commands | Meaning |
| --- | --- | --- |
| `-c, --config <file>` | all with entries | the config file, default `pcb.config.{ts,mts,js,mjs}` |
| `--verbose` | all with entries | every finding unfolded, Vite's output, stacks |
| `--json <file>` | `check`, `build` | write the report below |
| `-w, --watch` | `check` | recompile on every change, printing `N new, N fixed, N unchanged` and the new findings |
| `--fab` | `check` | read the Gerbers back, see fab-set.md |
| `-q, --quiet`, `--date <iso>` | `build` | only the board lines, findings and total; the fab files' date, see fab-set.md |
| `--out-dir <dir>` | `build`, `preview` | the site, default `.pcbjs/dist` |
| `-p, --port <port>` | `dev`, `preview`, `shot` | default 5173, 4173, a free one; `0` a free one |
| `--host [host]`, `--open` | `dev`, `preview` | listen on every interface or the one given; open the browser |
| `--workspace [folder]`, `--ide <url>`, `--ide-allow-remote` | `dev` | see workspace.md and editor.md |
| `--json`, `-t, --target <name>` | `inspect` | JSON instead of text; the target of a board with variants |
| `--lengths [filter]`, `--layer <name>` | `inspect` | the route table, or one layer's items, see inspect; repeatable |
| `--fresh` | `inspect`, `shot` | compile here even when a running dev server holds a current board |
| `-o, --out <dir>`, `--view <2d\|3d\|sch\|both\|all>`, `--size <WxH>` | `shot` | default `.pcbjs/shots`, `both` for 2D and 3D, `all` adds the schematic, `1600x1000` |
| `--explode <0..1>`, `--layer`, `--select`, `--side <top\|bottom>`, `--flip`, `--theme <light\|dark>` | `shot` | the view query of viewer.md, see shot |
| `--entry`, `--ref`, `--footprint`, `--as`, `--write`, `--force`, `--file` | `model` | see models.md |
| `-o, --out <file>`, `--force` | `import` | see import.md |
| `--grep <word>` | `docs` | matching lines of every topic, a regex unless plain words |
| `-t, --template <name>` | `create` | the template, `board` |
| `--layers <n>`, `--fab <preset>` | `create` | copper layers, 2, 4, 6 or 8, default 2; the preset after `@pcbjs/fab/`, default `JLCPCB/<layers>-Layer`, with that many layers |
| `--size <WxH>`, `--outline <shape>` | `create` | in mm, default `20x15`, one diameter for a circle, default 40; `rect`, `rounded`, `rounded:<r>` or `circle`, default `rounded` with 1 mm corners. The parts sit in the middle and need 20 x 15 mm, a circle 26 mm |
| `--example <name>`, `--list-examples` | `create` | copy an example board, a project with one board in `pcb.tsx`, instead of the template; print the examples with a line each |

## Output of check and build

Vite is silent unless `--verbose`. A run prints one line per board, or per target of a board with variants:

```
Blinky 0.1.0  pcb.tsx  9 footprints, 20 pads, 23 tracks, 4 vias, 1 zone, 7 nets  DRC ok  ERC ok  215 ms: route 3 ms, zones 13 ms, connectivity 5 ms, drc 26 ms, erc 8 ms
```

Name, revision and `[target]`; entry; counts; `DRC ok` or its counts, unconnected included; `ERC ok` or its counts; `FAIL` when not orderable; compile time and phases.

An autorouted board gets a routing line:

```
  routing 80 legs, 80 routed, 0 failed, 78 cached, 2 locked, 0 ripped, 0 rounds
```

Shared routing adds a `shared rules: …` line, see autorouter.md.

Then the findings by rule, the one that explains the next first: `route-failed`, `short`, `clearance`, `hole-to-copper`, other errors, warnings, `unconnected`. Identical lines print once with `xN`, at most 10 per rule, then `and N more <rule>`:

```
  DRC route-failed: 1 error
    error    route-failed  F.Cu  at (11.28, 24.49)  U1  route:9  pcb.tsx:5:16 via lib/fanout.tsx:85:16: cannot route net S9 from …
  DRC unconnected: 1 error
    error    unconnected  S9: net S9 is not fully connected: route route:9 failed, see route-failed
```

A finding line holds severity; the rule, `ERC` first for ERC rules; layer; `at (x, y)` in board mm; refs with instance paths; route id; `file:line:col` of the code to change, in a helper its call site then `via` the route call; the message. A line only some targets have ends with `[JLCPCB 2-Layer, House]`.

Unless `--verbose`, the `unconnected` findings of a net with a `route-failed` fold into one line, and three or more of one rule on one footprint into `56 findings on J2, the first at (x, y) on F.Cu: <message>`.

`build` adds the `fab` and `site` lines; the last line is the total over every board:

```
fab    .pcbjs/fab  6 sets, 94 files
site   .pcbjs/dist  4 boards, 6 entries, 8 pages  2.8 s
FAIL  DRC 3 errors, 0 warnings, 2 unconnected  ERC 0 errors, 0 warnings  1 entry failed to compile
```

A compile error prints `<entry>  compile error: <file:line:col>: <message>` in place of the board line.

With a `tsconfig.json`, `check` then runs tsc on the entries, cached in `.pcbjs/typecheck.json`: `typecheck  ok  450 ms`, or each error as `error    typecheck  pcb.tsx:12:5: TS2345 <message>` with the innermost reason of tsc's chain, the whole chain with `--verbose`. An error exits with code 1.

## The --json report

```ts
interface Report { boards: ReportBoard[] }
interface ReportBoard {
  name: string; target: string | null; entry: string
  status: 'ok' | 'fail' | 'error'   // fail: not orderable
  stats: Stats | null; timings: Timings | null; routing?: Routing; ms: number | null   // the board line's numbers
  counts: Record<'drcErrors' | 'drcWarnings' | 'unconnected' | 'ercErrors' | 'ercWarnings', number> | null
  models?: Record<'file' | 'generated' | 'none' | 'missing', number>   // parts by 3D body, see 3d.md
  drc: Finding[]; erc: Finding[]
  fab: { dir: string; zip: string } | null; pages: string[]   // build only
  error?: string
}
interface Finding {
  id: string   // stable across runs
  kind: 'drc' | 'erc'; severity: 'error' | 'warning'; rule: string; message: string; layer?: string
  at: [number, number] | null
  items: number[]   // item ids in the board model
  refs: { ref: string; path?: string }[]
  src?: string; via?: string   // file:line:col
  net?: string; route?: string; part?: string
}
```

Paths are relative to the project root. `drc` and `erc` hold every finding, unfolded, in the order of the text.

## inspect

`pcbjs inspect` prints absolute positions, nets, route lengths and the items of a layer from one compile; inspect.md has every query, its text and its JSON.

## shot

`shot` compiles the entries in a dev server on 127.0.0.1 and opens each board in a headless browser with the view query of viewer.md. Repeated `--select` and `--layer` shoot every combination, 3D once per part; `--explode` is 3D only. It waits for `data-ready`, at most 120 s, and saves `<dir>/<board>[-<target slug>]-<view>[-explode60][-select-U1][-F.Cu][-bottom][-dark].png`:

```
compiled  pcb.tsx  1.2 s
.pcbjs/shots/Blinky-3d-select-U1.png  Blinky  3d  1600x1000  4.9 s
```

`--view sch` opens the viewer's schematic view, `?view=sch`, fitted to what is drawn; `--select` selects the part and centres its symbol, `--theme` sets the colours, see viewer.md.

`--side bottom`, or `--flip`, looks from below as the viewer's flip and bottom buttons do: `shot --view 3d --select U1 --flip` frames a back-side part from under the board. The browser is `$PCBJS_CHROME`, else the first Chrome, Chromium or Edge found; without one, or on a compile error or timeout, `shot` exits with code 1.

## A running dev server

When `.pcbjs/dev.json` names a live dev server of the project, `inspect` and `shot` use its compile through `/__pcbjs/cli/` while no file of its module graph changed, on a workspace server the displayed scope only, and say so: `dev server  http://localhost:5173/  pcb.tsx current, compiled 4.0 s ago in 9.0 s; --fresh compiles here`. With `--fresh` or `shot -p` they compile themselves.

## Exit codes

0 when every board compiled and is orderable. 1 on a DRC or ERC error, an unconnected net, a compile or type error, an unknown `inspect` query, a failed `shot` or a usage error; warnings never. `build` still writes every file it can.

## Stale outputs

When an entry fails to compile, `build` keeps its last outputs: the board JSON gets `stale: true` and `staleError`, its fab directories a `STALE` file, the build prints `stale  <paths>` and exits with code 1. The dev server keeps the last good board, marked stale.

## Where files land

Everything under `.pcbjs/` is generated: `fab/<name>/` the fab sets, see fab-set.md; `dist/` the site; `routes/<name>.json` the route cache, see autorouter.md; `dev.json` a running dev server, see ide-bridge.md; `cache/` Vite's; `shots/` the PNGs.

## The dev server

`pcbjs dev` prints the same board lines, up to 5 findings per rule, and after each change `since the last compile: N new, N fixed, N unchanged`, recompiling only the boards that import the file. Its paths are in viewer.md.
