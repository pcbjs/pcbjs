# Development

Working on pcbjs itself: the packages, the build and test commands, and the support matrix's source.
Advanced. Rationale is in design.md; guidance for agents in skills.md and the README's For agents section.

## Commands

```sh
npm install
npm run build                       # tsc -b, every package in dependency order, then @pcbjs/ui's Vite library build
npm run watch                       # tsc -b --watch
npm test                            # every package's tests against dist: build first
npm test -w @pcbjs/compile          # one package's tests
npm run demo:dev                    # pcbjs dev with the four demo boards
npm run demo:build                  # pcbjs build with the four demo boards
npm run pack-smoke                  # pack, install into a fresh project, run every command
npm run preview -w demo             # serve the built demo site
npm run build -w @pcbjs/vscode      # type-check and bundle the extension
npm run package -w @pcbjs/vscode    # build the .vsix into packages/cli/vscode
npm run build -w @pcbjs/ts-plugin   # type-check and bundle the TypeScript plugin, which tsc -b leaves out
npm run docs:dev                    # the docs site with hot reload; docs:build and docs:preview
```

The CLI and tests use `dist`: rebuild after changing `src`. Outside `node_modules`, `pcbjs dev` keys the UI prebundle on the built `@pcbjs/ui` and `@pcbjs/core` content; rebuilding either triggers prebundling and reload. The root `tsconfig.json` references all packages; each references its dependencies. In `examples/demo`, `pcbjs check` checks four entries, Multi as three targets.

Tests set `PCBJS_FREEZE=1`, design.md. The typing latency benchmark starts its session with `PCBJS_FREEZE=0` to measure shipped behavior; other correctness cases retain the mutation guards. `scripts/test-watchdog.mjs` fails a test file still running after 10 minutes, `PCBJS_TEST_FILE_MS`. `scripts/stage-equality.mjs`, run by CI, compiles each example cold, warm, from route memos alone and past a corrupt object, failing unless all agree and warm hits every stage.

`site/` renders these topics, one page each; `pages.yml` deploys `main` to https://pcbjs.dev and the last train's docs to https://pcbjs.dev/stable/, site/README.md has the rest.

Installed VS Code acceptance is local-only. On Linux, run `npm run test:vscode:headless -- --code /path/to/VSCode-linux-x64/code --repo "$PWD" --vsix "$PWD/packages/cli/vscode/vscode-pcbjs.vsix" --out /tmp/pcbjs-vscode-report` after building and packaging. The suite uses a private virtual display without computer-control tools or an unlocked desktop. Reports, screenshots and logs stay in the chosen output directory. See `packages/vscode/tests/installed-host/README.md` for prerequisites and coverage; ordinary extension unit and integration tests still run in the shared CI suite.

## Formatting

Prettier uses `.prettierrc.json`, `proseWrap: preserve` for one-line paragraphs, `scripts/prettier-tables.mjs` to preserve table spacing, and `.prettierignore` for generated files. `npm install` runs `prepare`: simple-git-hooks installs a pre-commit hook formatting staged files through lint-staged. CI runs `npm run format:check`; `npm run format` rewrites the tree. There is no linter.

## Packages

Each `packages/<dir>` has `package.json`, `tsconfig.json`, `src`, `dist` and `tests`, except the source-served viewer has no `dist` and `@pcbjs/pcbjs` has only its bin and tests. `@pcbjs/ui` builds with Vite and vue-tsc. Cross-package imports use names, such as `@pcbjs/core/model`, and listed entries, never relative paths.

| package | dir | what it is for | depends on |
| --- | --- | --- | --- |
| `@pcbjs/core` | core | the elements and types, the compiled model, units, the JSX runtime, the schematic, circuits, sourcing, variants, defaults and config, base rules, stackups, net classes, impedance, text and fonts, the site data types | nothing |
| `@pcbjs/compile` | compile | flatten, routing, the autorouter, pairs, length tuning, zones, connectivity, DRC, ERC and the route cache | core, clipper-lib |
| `@pcbjs/step` | step | STEP to triangle meshes in Node, `stepToMesh`, and the mesh binary of `@pcbjs/step/binary`; OpenCascade's WASM never loads in the browser | core; occt-import-js, LGPL-2.1 |
| `@pcbjs/export` | export | Gerber, Excellon, BOM, placement, SVG, GLB, fab set, findings, site data, scene geometry | core, compile, step for meshes, fflate, three, clipper-lib, sharp |
| `@pcbjs/lib` | lib | the standard library, see stdlib.md, with the fab rule sets and stackups | core |
| `@pcbjs/fab` | fab | `bindPCB` and the fab presets, `@pcbjs/fab/JLCPCB/2-Layer` and the rest | core, lib |
| `@pcbjs/kicad` | kicad | KiCad's files: the s-expression reader, `readFootprint` and `kicadFootprint` for `.kicad_mod` footprints, the library and model path resolution, and the `.kicad_pcb` importer behind `pcbjs import`, see import.md | core, compile for the polygon union |
| `@pcbjs/ui` | ui | the views, chip, panels and store as prebuilt Vue components, ui.md | core; vue and three as peers; bundles export's scene code, lib, step's mesh binary |
| `@pcbjs/viewer` | viewer | the app `pcbjs dev` serves and `pcbjs build` prerenders from source: routes, top bar, load screens | ui, vue, three |
| `@pcbjs/lsp` | lsp | the language server of ide-bridge.md, loaded on an editor's `initialize` | core for types, compile, typescript, vscode-languageserver, vscode-jsonrpc |
| `@pcbjs/cli` | cli | the `pcbjs` command, the Vite plugin, the editor bridge, the templates, the bundled VSIX and, at pack time, these docs | every package above but lsp, an optional peer; @pcbjs/renderer, sharp, vite, esbuild, cac, ws, typescript |
| `@pcbjs/ts-plugin` | ts-plugin | the TypeScript service plugin that puts a `<PCB schematic>` module's exports in scope in an editor; one CommonJS bundle | nothing at run time; uses the typescript of the tsserver that loads it |
| `@pcbjs/vscode` | vscode | the VS Code extension, `pcbjs.vscode-pcbjs`; its package script writes the VSIX into packages/cli/vscode | nothing at run time; bundles ws and vscode-languageclient, ships ts-plugin as a TypeScript server plugin |
| `@pcbjs/skills` | skills | the agent skills in the Agent Skills format, one folder per skill at the package root and the `install` that `pcbjs skills` runs, see skills.md; plain files, no build | nothing |
| `@pcbjs/pcbjs` | pcbjs | what projects install: no code of its own, it depends on every component, lsp included, and provides the `pcbjs` bin, `bin/pcbjs.js`, which runs the cli | every package but vscode |

Code two copies of pcbjs may meet in one process, the CLI's and Vite's, keeps a project's state in the realm of `core/src/realm.ts`, whose `REALM_ABI` both must share, and knows parts, nets, nodes, presets and errors by a brand or a name, never `instanceof`.

Tests import their package from `../dist`; cross-package tests live in `packages/pcbjs/tests`.

## Entries

Each package's `exports` names every entry; there is no wildcard. The public entries, what designs, sites and tools import:

| package | public entries |
| --- | --- |
| `@pcbjs/core` | `.`, `jsx-runtime`, `jsx-dev-runtime`, `model`, `ref`, `finding`, `site-data`, `site-facets`, `site-shapes`, `platform`, `protocol` |
| `@pcbjs/lib` | `.`, `rules`, `stackups`, `impedance` |
| `@pcbjs/fab` | `.` and each preset, such as `JLCPCB/2-Layer` |
| `@pcbjs/compile` | `.`, `query`, `browser` |
| `@pcbjs/export` | `.`, `compose`, `browser-worker` |
| `@pcbjs/step` | `.`, `binary` |
| `@pcbjs/cli` | `.`, `vite`, `client`, `test`, `test-register` |
| `@pcbjs/ui` | `.`, `view2d`, `view3d`, `sch`, `checks`, `panels`, `models`, `style.css` |
| `kicad`, `lsp`, `skills`, `ts-plugin`, `vscode` | `.` |
| `@pcbjs/viewer` | none; the CLI finds the shell by its folder |

Packages of one train also import each other's `./internal/<module>` entries, listed one by one, undocumented and free to change between trains. `scripts/check-entries.mjs`, run by CI and the root `npm test`, fails on an import of an unlisted path, an internal entry named in docs, skills, examples or templates, a wildcard, an internal entry no other package imports, and a fab preset `exports` lacks.

## Repository layout

```
package.json               npm workspaces: packages/*, examples/*, site
tsconfig.json              project references to every package; tsconfig.base.json holds the shared options
docs/                      the topic files; pcbjs docs prints them
site/                      the docs site at https://pcbjs.dev: VitePress over docs/, with its own pages and the examples gallery
packages/core/src/         the elements, schematic, circuit, variants, defaults, model, types
packages/compile/src/      stages, runner, flatten, autoroute, tune, zones, drc, browser
packages/export/src/       svg, gerber, bom, fab, findings, site-data, board-glb, compose, scene/
packages/lib/src/          the standard library
packages/fab/src/          bind.ts and one module per preset, such as JLCPCB/2-Layer.ts
packages/kicad/src/        sexpr, footprint, library, read, board, import-board, emit
packages/ui/src/           views, panels, shell.ts, board-store.ts, pane.ts, scene/, models/
packages/viewer/src/       main.ts, App.vue, entry-server.ts, the load screens
packages/step/src/         STEP conversion with occt-import-js, the mesh binary and its cache key
packages/lsp/              the language server
packages/cli/              src/: commands over project/, render/, server/, session/, each importing those before; templates/, vscode/
packages/vscode/           the extension
packages/ts-plugin/        the TypeScript plugin
packages/skills/           @pcbjs/skills: <name>/SKILL.md and references/ per skill at the package root, index.mjs
packages/pcbjs/            @pcbjs/pcbjs: package.json, bin/pcbjs.js and the cross-package tests
examples/demo/             Blinky, Coin, Quad and Multi
examples/<name>/           the other boards; examples/README.md lists each with its known findings
```

## Releases

Changesets publishes linked trains: `@pcbjs/core` is a peer of its importers; `@pcbjs/pcbjs` pins all components. Versions record the last train and change only during releases. The 0.1.0 release plan exits beta and requests a minor bump for every component. Subsequent fixes use patch changesets; features and breaking changes before 1.0 use minor changesets. RELEASING.md covers workflows and owner setup. Published behaviour changes require `npm run changeset`.

## CI

`ci.yml` runs on pushes to `main` and `beta2` and pull requests: Prettier; build and test on ubuntu with Node 22 and 24, Windows and macOS with 22; `scripts/check-examples.mjs`, failing unless each example's findings match examples/README.md; the pack smoke test; the benchmark.

CLI, browser-heavy and language-server test files run serially so concurrent work does not distort latency checks. Set `PCBJS_DEBUG_SKETCH=1` to log draft preparation, module evaluation and geometry timings. Cancellation checkpoints also separate stage bodies from item identity generation.

`scripts/bench.mjs` times `pcbjs check` per example cold, without `.pcbjs/cache` and the typecheck cache, and warm, and `keystroke-to-first-facet`, ms from a key in Blinky's text block to its facet through a session, failing over a budget of `bench.json` by 20 percent and half a second or 30 ms; budgets are per machine kind, `ci` when `CI` is set, `--write` records this machine's medians, uploaded by the bench job. `view` drives the viewer on usb3-hub in a headless Chromium, `packages/pcbjs/tests/view-perf.mjs`, also run by `view-perf.test.mjs`: the main thread's work per frame, timed from the first animation callback to the end of that frame rather than the preceding vsync timestamp, WebGL rasterising nothing, idle, pointer move, wheel and drag, plain and with the 50 or more findings a drop of U1 makes, and in frames the hover and a drag's first response, against the fixed `view.budgets`: idle and move 4 ms, a wheel step 8 ms in 2D and 4 ms in 3D, a drag frame 16 ms, one frame, 3D draws at rest and under U1's fade exactly, else failing over by a quarter plus the run's peak one-minute load per CPU above a half.

The session compiles each project in a worker thread, `session/worker.ts`, which an edit cancels through shared memory in a few ms and which keeps the GLB, fab set and drawings, sending a board and site only when changed; a keystroke runs the keystroke tier, the full compile waits for the quiet period, session.md. `keystroke.test.mjs`, `worker-boundary.test.mjs` and compile's `cancel.test.mjs` hold their latencies.

Compile workers keep the process alive while a request is pending, including a retry after a worker crash. Idle workers do not prevent shutdown. Windows session events use portable project-relative source names; file identity accepts native, Vite and TypeScript separators. Length-tuning searches check cancellation between batches of columns; route collision checks do so between items and track segments. Board snapshots and unit boundaries also check cancellation.

## Support

support.md is generated from `site/features/`, listing supported, partial and missing features with tests or gaps. Catalogue format: site/README.md.

## Local review notes

Internal revision reports belong in Git-ignored `docs/local/`, served only by the development site at `/local/`. Use dated Markdown filenames and optional `docs/local/config.ts` labels; the sidebar puts the newest documents first. The Local nav item appears only when there is content, and production builds exclude it. Follow the contributor format and configuration in `site/README.md`, Local workspace documentation. Keep shared infrastructure tracked and private report content untracked.

Small example groups co-locate their `schematic` and `layout` / `layoutVariant` exports in one `.tsx` file. Prefer `schematic.layout(render, name?)` and use descriptive uppercase layout imports in board JSX; the standalone `layout` factory remains available. Keep runtime definition names stable and distinct per variant; the source mapper recognizes those explicit factory names independently of export aliases. Larger circuits may use separate modules.

## Purge and reload from VS Code

In a pcbjs source workspace, run **pcbjs: Purge Reload Dev Suite (dev)** from the Command Palette. It saves file-backed edits, disconnects this window, stops the checkout’s PCB sessions, runs the clean and build scripts, clears generated project and model caches, packages and reinstalls the extension, then reloads the window. Other clients of those PCB sessions disconnect too. The documentation dev server, source files, local reports and editor preferences are preserved. The command requires installed build dependencies and the `code` CLI on PATH.

Development mode enables the command automatically in the source workspace or extension development host; `pcbjs.development` enables it explicitly. A source checkout is still required, and multiple source checkouts in one workspace are rejected. Repeated clicks share one operation. A failed save cancels before shutdown; later failures stop at that step, show output and allow a retry. Session shutdown uses the extension transport, so a failed core build does not prevent the next purge attempt from stopping the old core. After correcting a build or install failure, rerun the command. No reload occurs until installation succeeds.
