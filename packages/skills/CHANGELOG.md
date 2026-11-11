# @pcbjs/skills

## 0.1.2

### Patch Changes

- [`ea71679`](https://github.com/pcbjs/pcbjs/commit/ea7167971cd85c63b373a36f5b4ac586bb11f355) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Remove VS Code popups for agent plans while retaining Agents activity and Send to agent. Direct MCP agents to communicate plans, progress, questions and completion through their main chat session.

## 0.1.1

### Patch Changes

- [`90ec7d2`](https://github.com/pcbjs/pcbjs/commit/90ec7d2d933d2f9144fc65c16ed47e3f0b7f0243) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Keep agent-authored board markings focused on physical use. Separate fabrication instructions from review caveats, discourage repeated disclaimers across artifacts, and make branding opt-in.

- [`90ec7d2`](https://github.com/pcbjs/pcbjs/commit/90ec7d2d933d2f9144fc65c16ed47e3f0b7f0243) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Preserve supported scalar PBR materials through model conversion, mesh caches, previews and GLB export, and correct imported normals under nonuniform transforms. Retain compatibility with legacy colour-only meshes.
  
  Provide shared custom-model composition and GLB authoring APIs, add mesh geometry and winding diagnostics to model checks and MCP, and document reusable stdlib models and custom-model validation.

- [`90ec7d2`](https://github.com/pcbjs/pcbjs/commit/90ec7d2d933d2f9144fc65c16ed47e3f0b7f0243) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Verify MCP session attachment before completing initialization and reconnect persistent agents after server restarts even without resource subscriptions. Restore task context, cancel reconnects on transport closure, and avoid restarting stopped servers in the background.
  
  Distinguish configured integrations from live agent inboxes in setup output, skills and guidance. Require message-consumption checkpoints and give Codex registrations time to complete the session handshake.

- [`90ec7d2`](https://github.com/pcbjs/pcbjs/commit/90ec7d2d933d2f9144fc65c16ed47e3f0b7f0243) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Clear stale hover and recover interrupted pointer gestures across the 2D, schematic and 3D previews. Keep silkscreen visible above solder mask at overview zoom without changing fabrication geometry.
  
  Guide agents to inspect actual via dimensions, reuse intentional via sizes across routing APIs, and distinguish rendering defects from fabrication geometry.

- [`90ec7d2`](https://github.com/pcbjs/pcbjs/commit/90ec7d2d933d2f9144fc65c16ed47e3f0b7f0243) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Make agent skills load topic references on demand and favor bounded worker tasks for independent work. Keep coordinator context focused on interfaces, decisions and verification, with explicit file and shared MCP inbox ownership. Split the basics tutorial and board patterns into focused references and align MCP guidance with progressive documentation discovery.

- [`90ec7d2`](https://github.com/pcbjs/pcbjs/commit/90ec7d2d933d2f9144fc65c16ed47e3f0b7f0243) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Add focused pin/endpoint and placement contracts, shared-project board defaults, resumed-task handoffs and draft-report comparisons that retain failing checks.

## 0.1.0

### Minor Changes

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Release pcbjs 0.1.0 with reusable schematic and layout definitions, synchronized 2D, 3D, schematic and DRC/ERC views, source-driven editing, and resilient editor sessions. Align every component and the bundled VS Code extension on the 0.1 release line.

### Patch Changes

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - `inspect <ref> --json` answers a part as `{ frame, part }` and adds the net answer under `net` when the ref also names a net, one shape either way. `inspect --references` prints the side a stacked reference lies on, F or B, or `coplanar`, beside its mate, and `--json` carries `side` and `stack` as the reference options name them.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Every CLI flag has one form. `shot --side F|B` picks the side on top and `shot --view` repeats, 2D and 3D by default; `shot --fresh` compiles here even when a session is live. `dev --workspace` is a switch and its arguments are the folders. `inspect --references` and `inspect --sch` print those reports, and a pad is `REF/PAD`, inside an instance `CH2/R/1`. `model add` and `model align` name the board with `--entry`. `create` writes the one board template. The config file is `pcb.config.{ts,mts,js,mjs}`.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - `pcbjs check`, `build`, `inspect` and `dev` serve a board whose files are unchanged from `.pcbjs/cache` without evaluating it. `check --cache` prints each stage as a hit or a miss with its key, `check --verbose` shows the hits, and `--fresh` on `check`, `build`, `inspect` and `shot` rebuilds every stage, `--fresh=all` rerouting too. Vite's cache is `.pcbjs/cache/vite` and referenced boards `.pcbjs/cache/references`.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - The docs are split into a basic path and advanced topics: `pcbjs docs` lists the basics first, from the new `basics` index that walks a first board end to end, then the rest under `advanced`. The advanced topics `check`, `stackup`, `footprints`, `route-options` and `vscode` hold what a first board does not need. The `pcbjs-basics` skill points at the topics by name, and the extension's README is a short listing page whose reference is `pcbjs docs vscode`.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - `pcbjs inspect --json` prints the records of `pcbjs q` beside the frame, one shape per thing: a part list `{ parts, models }`, a part `{ part, graphics }`, a pad `{ pad }`, a group `{ group, parts }`, a route `{ route, legs, tracks, vias }`, `--lengths` `{ routes }`, an item `{ item }`, a pair `{ pair, routes }`, a point `{ pt }`, a leg `{ leg }`, a span `{ span, vias }`, a plane `{ plane, zones, regions }` and a region `{ region }`; a net answer carries its net record as `net` with pad, track and via records. `--layer` lists item records with the ink `bounds` on that layer as `{ x, y, w, h }`, a `summary` and a pad's `rings`. The text is rendered from the same records, mm to 0.1 µm. The records grow to carry what inspect printed: a pad record its uid, number, name, rotation, size and drill in board axes and the footprint's; a part record its model and full pad records; a route record its pair, target as `{ min, max }` narrowed by its match group, skew with via barrels, tuning and helper call site, its status following the match group; an item record its compile id, a track's length, arcs, pair and role, a via's stitch flag, a pad's number and shape, a zone's priority, fill area and pieces, a text's size, thickness, strokes and glyphs, a drawing's paths, fill and arcs, and the source of the part that drew it; a pair record its source as `source`; a region record its hash, area and bbox.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - A part's ref is the name of the binding that holds it, in any file and in function bodies of a circuit build; a part made in a loop takes `{ ref }` in its options, and a placed part with no name is a compile error that suggests the next free one, which the language server offers as a code action. Circuit instances take an index, `channel(ports, 2)` or `channel(ports, 'CH2')`, and their parts are numbered from it, `CH2/R01` is `R201`. A bound route is `route:<name>`. A part or a bound route declared and never placed is a compile error. `.connect()` takes pins by name, a factory takes its value as a string then `{ ref, bom, pos, dnp, height, model }`, sourcing and BOM fields are `.source()`, and a placement takes `at`, `side`, `ref:at` and `thermal`. Every footprint on a board is a part, pinless parts included, so nets are `Net` values only and pads are named by their handles. `<Place part>` places a part the file cannot name on the board and in `<Schematic>`, a named `<g>` is a level of hierarchy, and the schematic drawing is the `drawing` export of the schematic module, in grid units. A part never connected, such as a mounting hole, raises no `unconnected-pin`.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Patches: `patch(ref, op, hash)` edits copper and placement by reference with six operations, `move`, `nudge`, `via`, `reroute`, `width` and `hold`, from `<PCB patches>`, inline in the tree and the default export of the `.patches.ts` file beside the entry, merged in that order. Each carries a hash of its target; a missing or changed target skips it with a `patch-stale` warning. Moves of parts and groups run at the end of `place`, `hold` and `reroute` before the router, the rest after `tune`. `pcbjs patch hold <route>` writes the copper of a route's automatic legs as a hold, which the router places first as an obstacle; the routing line and report count `held` legs, route records carry their `hash` and each leg its `copper`, and the route file keeps legs and tunes only.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - The skills say to keep design intent the user asks to keep as a board test run by `pcbjs check --test`, with goldens from `pcbjs test --update` guarding a refactor, and name `pcbjs q`, `script` and `events`.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - `pcbjs skills` is the one command that installs, lists and locates the skills; `@pcbjs/skills` ships the skills and the `install`, `skillNames`, `describe` and `skillsDir` exports it runs.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - The skills write `rev`, connector factories called for a part, `withPins` and `{ file }` font entries.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - The skills keep the workflow and leave the detail to the docs: each step names the pcbjs MCP tool first and the CLI command as the fallback, `pcbjs-basics` asks the agent to state its task and plan through the `session` tool before its first edit and to act on the human's messages first, and every skill that edits files says to change an existing file by edits, never by a whole-file Write. `pcbjs-upgrade` is the version bump procedure.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - The skills name `pcbjs shot --side B` for the back and query `inspect` by bare ref, as the docs do.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - The stacks reference describes the stack side taken from the local connector and named mating points.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - The pcbjs-upgrade skill is the version bump procedure: upgrade every @pcbjs package together, check cold then warm, compare with the baseline.

- [`c27688c`](https://github.com/pcbjs/pcbjs/commit/c27688cce51818a4448a580bc708b5f389a9a74e) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - Each package lists its entries by name. The public entries: `@pcbjs/core` with `jsx-runtime`, `jsx-dev-runtime`, `model`, `ref`, `finding`, `site-data`, `site-facets` and `platform`; `@pcbjs/lib` with `rules`, `stackups` and `impedance`; `@pcbjs/fab` with each preset such as `JLCPCB/2-Layer`; `@pcbjs/compile` with `query` and `browser`; `@pcbjs/export` with `compose` and `browser-worker`; `@pcbjs/step` with `binary`; `@pcbjs/ui` with `style.css`; `@pcbjs/cli` with `vite`, `client`, `test` and `test-register`; `@pcbjs/kicad`, `@pcbjs/lsp` and `@pcbjs/skills` with their root only. The modules the packages import from each other are `./internal/<module>` entries, listed one by one, for packages of the same train only.

- [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - First beta. Agent skills for designing boards with pcbjs, in the Agent Skills format, and the `pcbjs-skills` installer.

- [`c51b8d6`](https://github.com/pcbjs/pcbjs/commit/c51b8d6d5f777812e1af83b3b92d56c8bda6f4b1) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - `install` links each skill from `.agents/skills`, the Agent Skills folder that Codex and Grok Build read, and from `.claude/skills` for Claude Code, as relative symlinks into `node_modules/@pcbjs/skills/<name>`, so the skills follow the installed version. It copies when the package is not in a project's `node_modules` or no symlink can be made, and says so. `--to <dir>` installs into that folder alone and `--no-claude` skips `.claude/skills`. `install(cwd, { to, claude })` returns each skill's kind and companion, and `installLine` formats it. Each skill now sits at the package root, `@pcbjs/skills/<name>` in place of `@pcbjs/skills/skills/<name>`, and the package exports `./*`.

## 0.0.1-beta.1

### Patch Changes

- [`c51b8d6`](https://github.com/pcbjs/pcbjs/commit/c51b8d6d5f777812e1af83b3b92d56c8bda6f4b1) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - `install` links each skill from `.agents/skills`, the Agent Skills folder that Codex and Grok Build read, and from `.claude/skills` for Claude Code, as relative symlinks into `node_modules/@pcbjs/skills/<name>`, so the skills follow the installed version. It copies when the package is not in a project's `node_modules` or no symlink can be made, and says so. `--to <dir>` installs into that folder alone and `--no-claude` skips `.claude/skills`. `install(cwd, { to, claude })` returns each skill's kind and companion, and `installLine` formats it. Each skill now sits at the package root, `@pcbjs/skills/<name>` in place of `@pcbjs/skills/skills/<name>`, and the package exports `./*`.

## 0.0.1-beta.0

### Patch Changes

- [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - First beta. Agent skills for designing boards with pcbjs, in the Agent Skills format, and the `pcbjs-skills` installer.
