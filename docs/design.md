# Design

Why pcbjs is built the way it is: SVG as vocabulary, JSX without React, the schematic layer, the compile stages, and how a board is checked.
Advanced. Read it before changing the compiler; the user reference is the other topic files.

```ts
// what jsx() returns: a plain node, no React, no reconciler
const node = { $$: 'pcb', type: 'rect', props: { layer: 'Edge.Cuts', w: 40, h: 12 }, children: [] }
```

## SVG is the vocabulary, not the model

- pcbjs borrows SVG's words, `d` path data, `<g>`, `<rect>`, `<circle>`, `<line>` and nested transforms, which many people read.
- SVG has no nets, pads, drills, stack or rules, and a flip to the back swaps every `F.*` layer for its `B.*` twin, which no transform expresses.
- The canonical model is the compiled `Board` in `packages/core/src/model.ts`: flat pads, tracks, vias, zones, graphics and text in absolute mm, each with layer, net and footprint. Every exporter reads it; `<name>.pcb.svg` is one export, never parsed back.

## JSX without React

- `jsx()` returns a node `{ $$: 'pcb', type, props, children }`. A component is a pure function called once in flatten; the board recompiles on each change.
- The JSX types come from `types.ts`, so a misspelled prop fails in the editor; `jsxDEV` records where each element starts.

## The schematic layer

- Nets are values, because a string `GDN` is quietly a new net. `nets()` hands out `Net` objects through a proxy, a factory with a value gives a `Part`, and `.connect({ … })` checks pin names in TypeScript and at runtime. There are no string nets.
- A part's ref is its binding name, captured by `scope.ts` at the top level and in a circuit's build; a loop part takes `{ ref }`, and a placed part with no name is a compile error. Parts render with a placeholder ref rewritten once every part is known.
- A project's parts, defaults, KiCad config, model resolver and source mapper are one realm on `globalThis`, swapped by `inRealm`; parts and nets are known by their `$$` brand, as the CLI's pcbjs compiles what Vite's copy made. The compile takes the default layer as an option its key hashes. A re-evaluated module replaces its parts; a module-level part declared in the relevant design scope but never placed is a compile error; isolated library previews can retain unplaced template members.
- A circuit is a build function from ports to parts by key, typed so `Buck1.R1` checks. Private nets are scoped to the instance, named from its path. Ports are the only way across, enforced at `connect`. Refs stay flat for fabs and silk; the hierarchy is `path` and `local` in the netlist.
- A layout wraps its output in a marked group, so one circuit can have several, two layouts of one instance are rejected, and an instance never placed is one compile error, not one per part.

## Sourcing

A part carries `MPN` and `MPN:<tag>`; a board or fab target has an ordered tag list resolved like any setting, and each BOM row takes the first tag it has, else `MPN`. `.source()` on the part is the one place for its keys, inline or in a sourcing module that calls it on imported parts.

## The stage graph

`pcb.config.ts` and the entry load through Vite's SSR loader, which adds source ranges and transforms TSX with esbuild; entries share only the module graph. That load, `evaluateEntry` over a `ModuleLoader` in Node and in the browser worker, is the `evaluate` stage passed to `compileLoaded`, so one runner times, cancels and reports every stage. `STAGE_DEFS` in `compile/stages.ts` declares each stage once: what it runs `after`, the facets it `reads` and `writes`, the views it `emits`. The runner in `compile/runner.ts` runs the stages the wanted views need, with before and after hooks and two plugin slots:

| Stage | Reads | Writes | Code |
| --- | --- | --- | --- |
| `evaluate` | | the root, its targets checked, the plugins | `stages.ts`, `pipeline.ts` |
| `place` | | parts, pads, nets, netlist and its ERC, jobs, outline, references, patches, the dependency graph; unit `placer`, keyed on what it places | `flatten.ts`, `placer.ts`, `reference.ts`, `deps.ts` |
| `schematic` | meta, parts, pads, nets, netlist, rest, `jobs.sch` | the drawing, `sch-*` findings | `sch.ts` |
| `manualCopper` | as `autoroute` | each route's manual copper, `planRoutes` | `autoroute.ts` |
| `autoroute`, `placeFollowers`, `routeFollowers` | meta, rules, stackup, outline, keepouts, parts, pads, copper, frame, nets, netlist, routes, rest, jobs; drawings with followers or a shared group | legs, pairs, failures, the `at:follow` parts | `autoroute.ts`, `follow.ts` |
| `tune` | as `autoroute`, and the drawings within reach of a tuned route | meanders, skew bumps, route records | `tune.ts` |
| `patches` | | copper patches, `patch-stale` | `patches.ts` |
| `finish` | unit `pours`: as `autoroute` but netlist, rest and jobs, with `jobs.finish`, and drawings when a stitch keeps off silk; unit `silk`: meta, rules, outline, parts, pads, drawings, frame, `jobs.finish` | teardrops, fills, stitching vias; silk refs | `zones.ts`, `silk-refs.ts` |
| `checks` | a unit per `CheckDef` of `checks.ts`, then plugin checks | every finding by severity | `drc.ts`, `connectivity.ts` |
| `exports` | every facet, the formats' keys and model files | the formats the caller passes | `stages.ts`, formats in `cli/src/project/project.ts` |

- `beforeRoute` runs inside the routing unit before `autoroute`, `beforeChecks` before `checks`, each of its stages a unit of its own.
- Variants: `evaluate` once per entry; `place` and `schematic` for every target first; `autoroute` and `tune` once per routing group, its other targets copying the lead's tuned copper; later stages per target.
- Flatten calls components, composes `at` and side flips, resolves layers, maps nets to pads by number then pin name, and gives refs, the netlist and its ERC; errors carry the source.
- The schematic places symbols, checks hand wires and wires the rest in the router's square mode, `sch-route.ts`; see schematic-graphic.md.
- Every `route()` becomes jobs once the tree and outline are known; manual commands are placed first, then legs run by `priority` and document order through a `RouteContext`, with `maze`, `straight` or a custom `RouteFn`, each an obstacle for the next.
- Zones fill after routing, by priority: clip to the outline inset by `edgeClearance`, subtract other-net copper and holes, open by `zoneMinWidth`, drop islands; Clipper.
- Connectivity is union-find per copper layer, each pour piece its own item, one pass over grid candidates feeding DRC; tests are on edges, Clipper builds. DRC is findings.md.
- A hook's delta applies to its stage's input for `before`, its output for `after`; plugins.md.
- `want` lists views, `meta`, `sch`, `layers`, `shapes`, `model`, `findings`, `fab`; the plan is every stage whose `emits` meets them and what they run after: `sch` runs `evaluate`, `place` and `schematic`.
- `CompileOptions.signal` is read by `pulse()` in every stage and its loops, including pair layout candidates, sampled clearance checks, pair-segment comparisons and obstacle-grid updates: the compile throws `CancelledError` within a few ms, its finished units cached. Pair layout fallbacks preserve cancellation instead of treating it as a geometry failure.
- `sketch()`, the keystroke tier, is the plan of `meta` and `manualCopper` with the cache, the placer and references off.
- A stage that changes an item puts a new one in its place with its id and uid. `PCBJS_FREEZE=1`, on in the tests, deep-freezes each item as it joins the board and each field once no later stage writes it, and throws when a stage changes a facet its `writes` leaves out.
- `board.timings` keeps five phases.

Routing details:

- A failed leg is a `route-failed` finding with its nearest obstacles, so it hides no other leg; `<PCB strict>` throws instead.
- Legs are cached by request and nearby obstacles in `.pcbjs/cache/route/<board>.json`; a hold patch freezes a route, patches.md.
- A pair routes its centre line as one wide track, which `compile/pair.ts` offsets into two tracks with fans and via pairs; `compile/tune.ts` then tunes skew, `.length()` and `.match()`.
- autorouter.md has the rest.

## Cycles

`place` builds the dependency graph: a route to the parts it ends on, a part to its grid, a grid to its anchor, a follower to its route, a solver to what it reads, a `reference()` to its entry across processes through `PCBJS_REFERENCE_CHAIN`. A cycle or a self edge is a compile error naming each member: `grid-cycle`, `follow-cycle`, `solver-order` or `reference-cycle`. Nets, pours and `at:cost` are no edges; nothing iterates to a fixpoint.

## The stage cache

- `.pcbjs/cache` holds `meta.json` with `format` and `compileId`, Vite's cache in `vite/`, `index/<board>[~<slug>].json`, outputs as `objects/<hh>/<sha1>.json.gz` and binary exports as `.bin`, named by content and written by rename, the route memos in `route/<board>.json` and `references/`. `compileId` hashes `@pcbjs/compile` and `@pcbjs/core`, each with its `dist` hash in a workspace link.
- A unit is a stage, a run of stages stored as one such as routing, or a unit of a stage such as `checks:clearance`. Its key is the sha1 of its name, `compileId`, its plugins, the hash of each facet it reads and its own inputs; a hook in it makes it read every facet. Its output is the board's delta, its findings and what it keeps, the zone state or the tuning hand-off. `evaluate`, `place` and `patches` always run.
- A label edit misses the silk refs, the silk checks and the exports; `tune` reads only the drawings within reach of a tuned route.
- A plugin-free start whose listed files, environment digest, defaults and exporters all match serves the boards without evaluating. Plugin-bearing boards re-evaluate configuration before reusing individual stages. A missing object is a miss, a draft writes memory only, units done before a cancel are stored, and objects neither index names are pruned. `--fresh` is `make -B`; `check --cache` prints each unit's hit or miss and key.

## Hosts

Everything the compiler reaches outside JavaScript goes through the `Platform` of `@pcbjs/core/platform` on `globalThis`: files, sha1, paths, the environment and a `store`, the disk of the stage cache and route memos. Node's is the default; `memoryPlatform` keeps files in memory with no store, so its caches never meet Node's, browser.md.

## Source ranges

`packages/cli/src/project/source-ranges.ts`, a Vite transform before esbuild, adds a `__src` prop with the full range to every JSX element and every `route`, `pour` and `via` call. Flatten keeps it as the item's `src` and the enclosing calls as `chain`, outermost first; `sourceIndex` in `packages/export/src/site-data.ts` nests ranges per file with their item uids and refs.

## The 3D view

Item rows name each item by uid and compile-local id; the `shapes` facet holds its rings in board mm by id; `packages/ui/src/scene/items.ts` batches the extrusions by layer, a group per physical layer making explode a z offset.

## The IDE bridge

Every client, the editor too, joins the session `.pcbjs/dev.json` names, ide-bridge.md.

## The dev loop

1. Vite's watcher sees a change outside `.pcbjs` and `node_modules`.
2. The session's Vite plugin suppresses design HMR and passes edits to each project's runtime. Its scheduler gathers disk writes for 60 ms, starts sketches immediately with a 30 ms minimum interval and compiles the demanded views after 300 ms of typing quiet; a query requests every view, session.md.
3. Before the compile, `pcbjs:invalidate` marks what the edit makes stale; each stage's facet goes out as `pcbjs:facet` as it ends, then `pcbjs:boards` with per-entry errors; the viewer keeps zoom, hidden layers and selection, see viewer.md.
4. A failed compile sends `pcbjs:error`. The session attempts a cache-free preview of the current source before the failing expression, with placements, schematic geometry and manual copper only. `meta.halted` records the failed stage, ordered stages, completed stages and source location. The preview replaces all displayed facets, retains completed manual-route point provenance and current copper connectivity for endpoint assistance, clears check results and has no manufacturing artifacts. Failed entries remain absent from successful query snapshots. If recovery cannot construct a board, the last successful board is explicitly stale. A later edit of a failed entry runs every stage before clearing the error.

- Boards are keyed by `name`: `/__pcbjs/<name>/` in dev, `fab/<name>/` and `boards/<name>.json` in the site. The fab zip is built on request. `pcbjs build` runs the same compile, then writes fab sets, `boards.json` and the site.
- The site is prerendered from `packages/viewer/src/entry-server.ts`, each route an `index.html` with its facets, hydrated in place. State comes from `createViewer`; 2D and 3D render after hydration. Prerendering needs an absolute base; a relative base builds a client-rendered site.

## Validation plan

Port a fabricated two-layer KiCad board with a pour; compare each Gerber layer as geometry but fills, thermals, text and arcs; compare drills, the netlist and placement; check pcbjs DRC finds every KiCad error; load the Gerbers in a viewer and a fab's checker; order the board.
