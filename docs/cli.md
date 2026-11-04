# CLI

Every `pcbjs` command and flag, the `--json` report and a live session.
Advanced. Run commands in the project directory; the entries are `entries` in its pcb.config.ts. check.md reads the output of check and build and has the exit codes and where files land.

## Commands

| Command | Does |
| --- | --- |
| `pcbjs check [entry...]` | compile, route, DRC and ERC, no output files |
| `pcbjs inspect [entry] [query...]` | positions of footprints, pads, nets, routes or one layer's items, see inspect.md |
| `pcbjs q <reference>`, `script <code>`, `repl`, `events` | a reference's record; code against the board API; the session's events; see queries.md |
| `pcbjs test [file...]` | the board tests and goldens, see testing.md |
| `pcbjs build [entry...]` | check, then write the fab sets and the static site |
| `pcbjs build --lib` | the project as an npm package of its modules and boards, see library.md |
| `pcbjs dev [entry...]` | start or attach to the session with the live viewer and follow its log; Ctrl-C detaches, see session.md |
| `pcbjs dev --workspace [folder...]` | one session for every project under the folders, workspace.md |
| `pcbjs session <serve\|stop\|status>` | the session in the foreground for CI and workers; end it; describe it, exit 3 without one; see session.md |
| `pcbjs preview [entry...]` | serve the built site |
| `pcbjs shot [entry...]` | PNGs of the 2D, 3D and schematic views, no browser, render.md |
| `pcbjs diff <ref> [entry...]` | before, after and tinted diff PNGs and diff.json of each board against a git commit, diff.md |
| `pcbjs model <add\|align\|check\|fetch\|cache>` | 3D models, see models.md; `fetch` and `cache`, see 3d.md |
| `pcbjs patch hold <route>` | freeze a route's copper into the entry's `.patches.ts` file, see patches.md |
| `pcbjs place [entry...] [--write]` | print where each part with an `auto` slot went; `--write` freezes them into the source, see placement.md |
| `pcbjs import <footprint\|board> <source>` | a KiCad footprint or `.kicad_pcb` as code, see import.md |
| `pcbjs docs [topic]` | print a topic of these docs |
| `pcbjs create <dir>` | a new project from the template or an example |
| `pcbjs ide <install\|status>` | the bundled VS Code extension, see editor.md |
| `pcbjs skills <install\|list\|path>` | the agent skills of `@pcbjs/skills`, linked from `.agents/skills` and `.claude/skills`, with `pcbjs mcp`, the language server and the hooks registered, see skills.md |
| `pcbjs mcp` | the MCP server for coding agents on stdio, a client of the session it starts when none is live, see mcp.md |
| `pcbjs lsp --stdio [--agent]` | the language server for any editor on stdio, a client of the session, see lsp.md |
| `pcbjs hook <prompt\|edited>` | the agent harness hooks `skills install` writes, the hook's JSON on stdin, see skills.md |
| `pcbjs cache clear [folder...]` | delete `.pcbjs/cache` and `.pcbjs/typecheck.json` of every project under the folders, the working directory without any, and `.pcbjs/models` with `--models`; refuses while a live session serves one, unless `--force` |
| `pcbjs doctor` | the `@pcbjs` versions, the renderer's too, Node, the step converter, the cache formats, the config, the desync incidents, `--desync` the last; exit 1 when two packages differ in major.minor, which check, build and dev warn of, or the project's core in realm abi |

An entry is a `.tsx` or `.ts` module that default-exports `<PCB>`, listed in the config's `entries`, globs allowed; entries on the command line win for that run. `inspect` takes the config's only entry, or the one named first. Two entries with the same board name are an error. `DEBUG=1` prints stack traces. `pcbjs -v` prints every `@pcbjs` package the project resolves on one line, `--help` starts with it.

## Flags

| Flag | Commands | Meaning |
| --- | --- | --- |
| `-c, --config <file>` | all with entries | the config file, default `pcb.config.{ts,mts,js,mjs}` |
| `--verbose` | all with entries | every finding unfolded, Vite's output, stacks; `check` and `build` a line per stage |
| `--json <file>` | `check`, `build`, `test` | write the `pcbjs.check/1` report below |
| `--test`; `--update` | `check`; `test` | run the board tests after the checks; write the goldens first, testing.md |
| `--board`, `--timeout`, `--watch`, `--scope`; `--since`, `--wait`, `--for`, `--follow`, `--kind` | `q`, `script`, `repl`; `events` | see queries.md |
| `-w, --watch` | `check` | recompile on every change, printing `N new, N fixed, N unchanged` and the new findings; through a session, each findings event |
| `--fab` | `check` | read the Gerbers back, see fab-set.md |
| `--cache` | `check` | each cached stage or unit, such as `checks:clearance`, as `cache  <unit>  hit\|miss  <first 12 hex of its key>`, as `make -n` |
| `--fresh[=all]` | `check`, `build`, `inspect`, `shot`, `q`, `script`, `test` | every stage rebuilt as `make -B`: the cache index and objects deleted, with `all` the route memos too; compile here even with a live session |
| `-q, --quiet`, `--date <iso>` | `build` | only board lines, findings and total; the fab files' date, see fab-set.md |
| `--out-dir <dir>` | `build`, `preview` | the site, default `.pcbjs/dist`; with `--lib` the package, default `dist` |
| `-p, --port <port>` | `dev`, `session serve`, `preview` | default 5173, 4173, a free one; `0` a free one; for `dev` only when it starts the session |
| `--host [host]`, `--open` | `dev`, `session serve`, `preview` | listen on every interface or the one given; open the browser |
| `--workspace` | `dev`, `session` | the arguments are folders, see workspace.md |
| `--edit <mode>`, `--grace <s>` | `dev`, `session serve` | `localhost`, `all` or `none`, who may edit; seconds without clients, default 600; see session.md |
| `--ui-src [folder]` | `dev`, `session serve` | serve `@pcbjs/ui` from its source in a pcbjs checkout, for work on the components, see ui.md; refused on an install |
| `--json` | `session status` | JSON |
| `--json`, `-t, --target <name>` | `inspect` | the records of `q` as JSON instead of text; the target of a board with variants |
| `--lengths [filter]`, `--layer <name>` | `inspect` | the route table, or one layer's items, see inspect; repeatable |
| `--references`, `--sch`, `--grids` | `inspect` | each `reference()`, the schematic drawing, each grid, see inspect |
| `-o, --out <dir>`, `--view <2d\|3d\|sch>`, `--size <WxH>` | `shot` | default `.pcbjs/shots`; repeatable, default 2D and 3D; default `1280x960` |
| `--camera`, `--frame`, `--highlight`, `--select`, `--layer`, `--side`, `--explode`, `--findings`, `--theme` | `shot` | the render spec; render.md has these and the rest |
| `--entry`, `--ref`, `--footprint`, `--as`, `--write`, `--force`, `--file`; `-o, --out <file>` | `model`; `import` | see models.md; import.md |
| `--grep <word>` | `docs` | matching lines of every topic, a regex or plain words |
| `--layers <n>`, `--fab <preset>` | `create` | copper layers, 2, 4, 6 or 8, default 2; the preset after `@pcbjs/fab/`, default `JLCPCB/<layers>-Layer`, with that many layers |
| `--size <WxH>`, `--outline <shape>` | `create` | mm, default `20x15`, a circle 40; `rect`, `rounded`, `rounded:<r>` or `circle`, default `rounded` with 1 mm corners |
| `--example <name>`, `--list-examples` | `create` | copy an example project instead of the template; print the examples |

## The --json report

`check --json <file>` and `build --json <file>` write one `pcbjs.check/1` report, after the typecheck; `check --watch` typechecks again after each recompile and rewrites it.

```ts
import type { Finding, SourceRef } from '@pcbjs/core/finding'
import type { Board } from '@pcbjs/core/model'

interface CheckReport {
  schema: 'pcbjs.check/1'; command: 'check' | 'build' | 'test'
  result: 'ok' | 'fail' | 'error'   // error: an entry or the config failed; fail: a board not orderable, or type errors
  exit: 0 | 1; ms: number
  versions: Record<string, string>   // the @pcbjs packages the project resolves, and node
  boards: {
    name: string; target: string | null; entry: string; status: 'ok' | 'fail'
    snapshot: string | null   // 16 hex over the board's final output
    stats: Board['stats'] | null; routing?: Board['routing']
    stages: { name: string; ms: number; hit: boolean }[]
    findings: Finding[]   // findings.md, with `route` the route:<n> it concerns
    fab: { dir: string; zip: string } | null; pages?: string[]   // build only
    counts: Record<string, number> | null; schematic?: Record<string, number>; models?: Record<string, number>   // as the board line, schematic-graphic.md, 3d.md
  }[]
  diagnostics: {
    kind: 'compile' | 'type' | 'config' | 'reference' | 'cycle' | 'plugin'
    code: string   // such as compile-error, board-name, config-error, grid-cycle, reference-cycle, plugin-error, TS2345
    severity: 'error' | 'warning'; message: string; entry?: string; src?: SourceRef
  }[]
  typecheck: { status: 'ok' | 'errors' | 'skipped'; errors: number; cached: boolean; ms: number }
  cache: { stages: number; hits: number }   // keyed stages over every board
  tests?: { status: 'ok' | 'fail' | 'skipped'; passed: number; failed: number; ms: number; results: unknown[] }   // check --test and test, testing.md
}
```

Paths are relative to the project root. A failed entry and a type error are diagnostics, never boards or findings; `findings` holds every finding unfolded, in the text's order.

## inspect, shot, q, script, events and test

inspect.md has every `inspect` query and its output; render.md `shot`; queries.md `q`, `script`, `repl` and `events`; testing.md `test`.

## A live session

One-shot commands never start a session; `pcbjs mcp` and `pcbjs lsp --stdio` do, on a free loopback port, when none is live. When `.pcbjs/dev.json` names a live one, `check`, `inspect`, `shot`, `q`, `script` and `test` ask it, which compiles what changed first, and print `session k3x9q2ab  snapshot k3x9q2ab.7; --fresh compiles here` on stderr, with the files whose unsaved text it compiled. `check` and `inspect` print the same as in process; `check --fab` and `--cache` always compile here. `place --write`, `patch hold` and `model add --write` compile here and write through its `session/write`, so an editor holding the file takes the edit unsaved; with no session they write the disk.
