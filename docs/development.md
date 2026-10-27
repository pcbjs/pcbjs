# Development

Working on pcbjs itself: the packages, the build and test commands, and what pcbjs does not do yet.
Rationale for the design is in design.md; guidance for agents is in skills.md and the README's For agents section.

## Commands

```sh
npm install
npm run build                       # tsc -b: every package in dependency order
npm run watch                       # tsc -b --watch
npm test                            # every package's tests, against dist: build first
npm test -w @pcbjs/compile          # one package's tests
npm run demo:dev                    # pcbjs dev with the four demo boards of the demo's config
npm run demo:build                  # pcbjs build with the four demo boards
npm run pack-smoke                  # install the npm pack tarballs into a fresh project and run every command there
npm run preview -w demo             # serve the built demo site
npm run build -w @pcbjs/vscode      # type-check and bundle the extension
npm run package -w @pcbjs/vscode    # build the .vsix into packages/cli/vscode
npm run build -w @pcbjs/ts-plugin   # type-check and bundle the TypeScript plugin, which tsc -b leaves out
npm run docs:dev                    # the docs site with hot reload; docs:build and docs:preview build and serve it
```

The CLI and the tests run from each package's `dist`, so rebuild after changing any `src`. The root `tsconfig.json` lists every package as a project reference and each package references the packages it imports, so `tsc -b` builds them in order and fails when a reference is missing. From `examples/demo`, `pcbjs check` checks all four demo boards, the `entries` of its config, Multi as three targets.

The docs site in `site/` renders these topic files as they are, one page each. `.github/workflows/docs.yml` deploys it from every push to `main` to https://next.pcbjs.dev, and `release.yml` deploys the stable site to https://pcbjs.dev after a publish; site/README.md has the pages, the gallery, the DNS records and the one-time deploy key setup.

## Packages

Every component lives in `packages/<dir>` with its own `package.json`, `tsconfig.json`, `src`, `dist` and `tests`; the viewer is served from source and has no `dist`, and `@pcbjs/pcbjs` has only its bin and tests. Packages import each other by name, such as `@pcbjs/core/model`, never by a relative path into another package; every package exports `.` and `./*` for its modules.

| package | dir | what it is for | depends on |
| --- | --- | --- | --- |
| `@pcbjs/core` | core | the element and board types, the compiled model, units, the JSX runtime, the schematic, circuits, sourcing, variants, the defaults and config, the base rules, the stackup builders and board spec, net class tables, trace impedance, text and the stroke fonts, the site data types | nothing |
| `@pcbjs/compile` | compile | flatten, routing, the autorouter, pairs, length tuning, zones, connectivity, DRC, ERC and the route cache | core, clipper-lib |
| `@pcbjs/step` | step | STEP files to triangle meshes in Node, `stepToMesh`, and the compact binary the viewer decodes, `meshToBinary` and `meshFromBinary` in `@pcbjs/step/binary`; OpenCascade's WASM loads on the first conversion, never in the browser | occt-import-js, LGPL-2.1 |
| `@pcbjs/export` | export | Gerber, Excellon, BOM, placement, SVG, the fab set, the findings text and the site data | core, compile, step for the mesh hash, fflate |
| `@pcbjs/lib` | lib | the standard library, see stdlib.md, with the fab rule sets and stackups | core |
| `@pcbjs/fab` | fab | `bindPCB` and the fab presets, `@pcbjs/fab/JLCPCB/2-Layer` and the rest | core, lib |
| `@pcbjs/kicad` | kicad | KiCad's files: the s-expression reader, `readFootprint` and `kicadFootprint` for `.kicad_mod` footprints, the library and model path resolution, and the `.kicad_pcb` importer behind `pcbjs import`, see import.md | core, compile for the polygon union |
| `@pcbjs/viewer` | viewer | the Vue site, 2D and 3D, served and built from source by Vite; it imports core for types only | core, lib for the value parsers, step for the mesh binary, three, vue |
| `@pcbjs/lsp` | lsp | the language server of ide-bridge.md: hovers, definitions, highlights, lenses, inlay hints, diagnostics and the editable segments with their edits, over the site data the dev server compiled. The dev server imports it only when an editor sends `initialize`; check, build and CI never load it | core for types, typescript, vscode-languageserver, vscode-jsonrpc |
| `@pcbjs/cli` | cli | the `pcbjs` command, the Vite plugin, the editor bridge, the templates, the bundled VSIX and, at pack time, these docs | every package above but lsp, which is an optional peer loaded with a dynamic import; vite, @vitejs/plugin-vue, cac, ws, launch-editor, magic-string, typescript |
| `@pcbjs/ts-plugin` | ts-plugin | the TypeScript language service plugin that puts the exports of a `<PCB schematic>` module in scope in an editor, mapping every position through the insertion; one CommonJS bundle with the injector of compile, built by esbuild | nothing at run time; uses the typescript of the tsserver that loads it |
| `@pcbjs/vscode` | vscode | the VS Code extension, identifier `pcbjs.vscode-pcbjs`: the spawn, the language client, the focus relay, the preview and one widget per segment kind, nothing that knows boards; its package script writes the VSIX into packages/cli/vscode | nothing at run time; bundles ws and vscode-languageclient, ships ts-plugin as a TypeScript server plugin |
| `@pcbjs/skills` | skills | the agent skills in the Agent Skills format, the `pcbjs-skills` bin that installs them and the script that copies the changelog's Migration sections into `pcbjs-upgrade`, see skills.md; plain files, no build | nothing |
| `@pcbjs/pcbjs` | pcbjs | what projects install: no code of its own, it depends on every component, lsp included, and provides the `pcbjs` bin, `bin/pcbjs.js`, which runs the cli. Design code imports the components: `@pcbjs/core`, `@pcbjs/lib`, `@pcbjs/fab/JLCPCB/2-Layer`, `compileBoards` from `@pcbjs/compile`, and `"jsxImportSource": "@pcbjs/core"` | every package but vscode |

Code that more than one copy of pcbjs may meet in one process, the CLI's and the one Vite loads for the design, keeps its state on `globalThis` and recognises parts, nets, nodes, presets and errors by a brand or a name, never by `instanceof`. With several packages a second copy is more likely, so keep it that way.

Tests sit with the package they test and import it from `../dist`. Tests that need several packages, such as a compile test that builds a board from the standard library, are in `packages/pcbjs/tests`.

## Repository layout

```
package.json               npm workspaces: packages/*, examples/*, site
tsconfig.json              project references to every package; tsconfig.base.json holds the shared options
docs/                      the topic files; pcbjs docs prints them
site/                      the docs site at https://pcbjs.dev: VitePress over docs/, with its own pages and the examples gallery
packages/core/src/         index.ts with PCB, route, pour, via, keepout; schematic, circuit, variants, defaults, model, types
packages/compile/src/      flatten, route-path, autoroute, pair, length, meander, tune, route-cache, zones, connectivity, drc
packages/export/src/       svg, gerber, excellon, bom, fab, items, findings, site-data
packages/lib/src/          the standard library
packages/fab/src/          bind.ts and one module per preset, such as JLCPCB/2-Layer.ts
packages/kicad/src/        sexpr, footprint, library, read, board, import-board, emit; tests/fixtures holds KiCad library footprints and boards
packages/viewer/src/       App.vue, BoardView.vue, View3D.vue, scene/, models/
packages/step/src/         STEP conversion with occt-import-js, the mesh binary and its cache key
packages/lsp/              the language server: server, segments, detect, path-model, values, describe, protocol, channel
packages/cli/              src/ with cli, check, inspect, build, server, workspace, scopes, plugin, bridge, host-client, lsp, ide, create; templates/, vscode/
packages/vscode/           the VS Code extension source: host, server, language, lsp-client, sync, preview, segments-ui, fallback
packages/ts-plugin/        the TypeScript plugin: src/index.ts wraps the host and the language service, src/map.ts maps positions
packages/skills/           @pcbjs/skills: skills/<name>/SKILL.md and references/, bin/pcbjs-skills.mjs, scripts/sync-changelog.mjs
packages/pcbjs/            @pcbjs/pcbjs: package.json, bin/pcbjs.js and the cross-package tests
examples/demo/             Blinky, Coin, Quad and Multi
examples/<name>/           boards built by reviewers; examples/README.md lists each with its known findings
examples/highspeed/        a USB-C to header adapter: 90 ohm differential pairs, one by hand, one autorouted through a via pair, and a length matched bus
```

## Releases

The packages are published from this repository with Changesets as linked trains, `@pcbjs/core` a peer of every package that imports it and `@pcbjs/pcbjs` pinning them all. Every package is at 0.0.0 in the tree, the version of the placeholders published once by hand from outside the repository, and every changeset is a patch during the beta, so the trains are 0.0.1-beta.0 and on; RELEASING.md has the model, the workflows and the owner's setup. A behaviour change to a published package adds a changeset with `npm run changeset`. CI runs `scripts/check-examples.mjs`, which checks every example and fails unless its findings are exactly those the examples README lists.

## Not there yet

- No schematic drawing. The schematic is a netlist in code, with no symbols or sheets.
- No synthetic bold or italics: a bold or italic outline font needs its own file, and stroke text has no italic slant.
- Thermal relief gaps are 16-sided polygons around the pad, not round, and spokes never join two pads of the net without the fill between them.
- Bezier curves, elliptical arcs and zone fills reach the Gerbers as segments; only circular arcs stay arcs.
- No interactive routing. Negotiation moves only automatic legs of `route()`, rerouting them whole: it never moves locked routes, manual stretches, drawn tracks or whole-net tracks, never shoves a track sideways, and stops after `ripup` rounds, so routes that cannot all fit still need a waypoint, a layer or a manual stretch. A tangled breakout can take ten seconds or more the first time; the cache makes the next compile instant.
- Length tuning is single sided serpentines of U bumps spliced into the segments of a route, after routing, and cannot add less than the smallest U bump: it never reroutes a route to make room, never shortens a route that is too long, and the meanders of neighbouring routes take their room in document order rather than sharing it.
- No KiCad export. The importer, import.md, carries no `.kicad_dru` custom rules or per-pad clearances, and recomputes zone fills.
- No code pane in the browser. Source links open the editor or the repository host.
- The 3D view does not export 3D.
- `silkToPad` is listed for the fab but not checked. There is no courtyard-over-edge check.
