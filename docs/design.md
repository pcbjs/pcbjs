# Design

Why pcbjs is built the way it is: SVG as vocabulary, JSX without React, the schematic layer, the compile passes, and how a board is checked.
Read it before changing the compiler; the user reference is the other topic files.

## SVG is the vocabulary, not the model

Board geometry is mostly paths, groups and transforms, and SVG already has words for those that many people read and every browser draws: `d` path data, `<g>`, `<rect>`, `<circle>`, `<line>`, nested transforms. So pcbjs borrows them.

SVG cannot be the canonical model. It has no nets, pads, drills, layer stack or rules; a stroke is a rendering hint where a board needs copper of a width DRC and the Gerber writer agree on; flipping a footprint to the back mirrors it and swaps every `F.*` layer with its `B.*` twin, which no SVG transform expresses; mask, paste and text outlines are derived, not drawn.

The canonical model is the compiled `Board` in `src/model.ts`: a flat list of items in absolute millimetres, pads, tracks, vias, zones, graphics and text, each with a layer, a net and its footprint. Every exporter reads it. `<name>.pcb.svg` is one export, a picture with `pcb:` metadata, never parsed back. The TSX source stays the source of truth.

## JSX without React

JSX gives a tree syntax with real TypeScript around it: loops, functions, imports, typed props. pcbjs ships its own runtime; `jsx()` returns a plain node `{ $$: 'pcb', type, props, children }`. A board has no state and no events, so there is no reconciler, no hooks and no virtual DOM: a component is a pure function called once during flatten, and the whole board recompiles on every change. The JSX types come from `types.ts`, so a misspelled prop fails in the editor, and `jsxDEV` records where every element starts.

## The schematic layer

Nets typed as strings fail late and quietly: a misspelled `GDN` is a new net with one pad. So nets and parts are values. `nets()` hands out `Net` objects through a proxy, a footprint factory called with a value hands out a `Part`, and `.connect(...)` binds pins to nets at the call, where TypeScript checks the pin names and the runtime the count. The layout imports those values and places each part as a JSX element, so the editor follows a net or part back to its declaration. Strings remain the escape hatch, and `strictNets` turns them off.

Refs are not written down. A per-process registry gives every part a sequence number when it is created, and the flattener numbers the placed parts per prefix in that order, after explicit refs, so R1 to R3 follow the schematic and stay put while parts move. Parts are rendered with a placeholder ref that is rewritten once every part is known, because parts made inside components appear only during the render. The registry lives on `globalThis` and recognises parts and nets by their `$$` brand, since the CLI's copy of pcbjs compiles what the copy in Vite's SSR loader created. Each part remembers its file, mapped through Vite's source maps; a module evaluated again replaces its earlier parts, and a module-level part from a file that placed parts, but not placed itself, is an ERC error. ERC findings share the shape of DRC markers, so every consumer handles both alike.

Circuits organise a schematic by function without giving up flat refs. A circuit is a build function from ports to parts by key; an instance's keys are typed, so `Buck1.R1` is checked like any part. Private nets are scoped to the instance object, and the flattener reads the instance path when it names them, because an instance takes its name late, from its key inside another circuit or from the object form that adopts it. Ports are the only way across the boundary, enforced at `connect`. Refs stay flat because fabs and silk want short refs; the hierarchy travels beside them as `path` and `local` in the netlist. Layouts are separate components that wrap their output in a marked group, so one circuit can have several, and the mark tells a laid-out part from a hand-placed one, rejects two layouts of one instance and turns a pile of `unplaced-part` errors into one `unplaced-circuit`.

## Sourcing

JLCPCB assembles from LCSC stock, a US house wants DigiKey numbers. So a part carries `MPN` and `MPN:<tag>` fields, and a board or fab target carries an ordered list of tags that resolves like any board setting; each BOM row takes the first tag it has a number for, else its `MPN`. `source()` modules merge under a part's own keys, and a factory and value rule is scoped through the entry's module graph, because the registry is per process and would otherwise reach every board compiled after it.

## Compile passes

1. Load. Vite's SSR loader imports the entry, adds source ranges, transforms TSX with esbuild and keeps a module graph. Several entries each run every pass on their own, sharing only the graph.
2. Flatten. Walk the tree, call components, compose `at` transforms and side flips, resolve layer names, map `net:*` attributes to pads by number, then pin name, `net:pad1` standing for pad 1 since JSX cannot spell `net:1`. Place parts with placeholder refs, take pad nets from the connections, number the parts and build the netlist and ERC. Errors carry the source location.
3. Outline. Chain the `Edge.Cuts` items into closed rings for the bounds, zones and DRC.
4. Schematic. `compile/sch.ts` places the symbols, checks the hand wires against the netlist and wires the rest in the router's square mode, `sch-route.ts`; see schematic-graphic.md.
5. Autoroute. Flatten never routes. Every `route()` and every track whose `d` is an `AutoRoute`, a `RouteFn` or omitted becomes a job, run once the whole tree and the outline are known, so a route sees every part wherever it was declared. Ends are resolved and nets inferred, manual path segments and `@<layer>` vias are placed, then the automatic legs run by `priority` and document order, each against the items placed so far through a `RouteContext` the compiler builds, with `maze`, `straight` or a custom `RouteFn`. Every routed leg is an obstacle for the next, which is why the order is fixed. A leg that fails becomes a `route-failed` finding with its nearest obstacles, so one bad leg never hides the rest; `<PCB strict>` throws instead. Legs are cached by request and a hash of nearby obstacles in `.pcbjs/routes/<board>.json`, and `.lock()` pins a route. A pair routes its centre line as one wide track, then `compile/pair.ts` offsets it into two coupled tracks with fans and via pairs. Once routing is final, `compile/tune.ts` tunes pair skew and `.length()` and `.match()` routes with meanders, a pure function of the routed board. Boards with `variants()` route once under the strictest rules of their targets. autorouter.md has the details.
6. Zone fill. In priority order, clip each zone to the outline inset by `edgeClearance`, subtract other-net copper grown by the clearance and holes grown by `holeClearance`, open by `zoneMinWidth`, and drop the islands, pieces that connectivity on the layer joins to no pad or via of the zone's net. Polygon work goes through Clipper. Pours come after routing, so they are no obstacle and tracks carve their clearance out of them.
7. Connectivity. Per copper layer, same-net items that overlap are joined with union-find, each piece of a pour's fill an item of its own; different nets that overlap are shorts. Candidate pairs come from a uniform grid, `compile/spatial.ts`, which DRC and zone fill share, so the pass grows with nearby pairs, not the square of the item count. A net left in several islands gets ratsnest lines from a greedy nearest-pair spanning.
8. DRC. The rules in findings.md, then the router's `route-failed` findings and the `keepout` check. `board.timings` records the wall time of each phase for the CLI.
9. Export. Per-layer SVG, `<name>.pcb.svg`, Gerber X2, the job file, Excellon, BOM, placement, `README-fab.txt` and the zip.
10. Site data. Layers, footprints with pads and sources, stackup, DRC, ERC, netlist, ratsnest, BOM and the source index, as the viewer receives them.

## Source ranges

`jsxDEV` records only where an element starts, and helper calls record nothing. So `packages/cli/src/source-ranges.ts`, a Vite transform before esbuild, parses each project file with the TypeScript compiler and adds a `__src` prop with the full 1-based range to every JSX element and every `route`, `pour` and `via` call imported from pcbjs. Flatten strips it, records it as the item's `src` and keeps the enclosing call sites as `chain`, outermost first. `sourceIndex` in `packages/export/src/site-data.ts` turns that into nested ranges per file with the item ids and refs each produced; the viewer resolves a click to the smallest range listing the item and a cursor to the innermost range containing it.

## The 3D view

A click in 3D must name the item it hit, so the site data carries `items` from `packages/export/src/items.ts`: every item as polygon rings in board millimetres with its id, kind, layers, net, ref and drill, holes told apart by the sign of their area. Ids are the model's, so a source range, a click and a DRC item meet on one number. `packages/viewer/src/scene/items.ts` extrudes one mesh per item and layer, caching geometries by ring and sharing one material per role, colour and highlight state. The scene is a group per physical layer, so the exploded view is a z offset per group. The mask is a slab with the openings cut out plus a skin over the outer copper.

## The IDE bridge

The editor link rides the dev server's own HMR WebSocket and a few HTTP paths, so there is no second server to find; `.pcbjs/dev.json` says where it is. The VS Code extension in `packages/vscode` is one bridge, installed only on request with `pcbjs ide install`. ide-bridge.md has the protocol.

## The dev loop

1. Vite's watcher sees a change in the project, outside `.pcbjs` and `node_modules`.
2. The pcbjs plugin returns no modules to Vite's HMR, so the page never reloads. It walks the importers of the changed file up the SSR graph to the entries that reach it, adds boards whose last compile failed, and compiles them after 60 ms of quiet. A file outside the graph schedules every board.
3. Changed modules are re-imported and each scheduled board compiles through all passes.
4. Each board's site data goes to the browser as `pcbjs:board`, then the list as `pcbjs:boards` with per-entry errors. The viewer replaces its state in place, keeping zoom, hidden layers and selection.
5. A failed compile sends `pcbjs:error`, shown over the last good board.

Several entries share one dev server and one site, keyed by board `name`: `/__pcbjs/<name>/` in dev, `fab/<name>/` and `boards/<name>.json` in the site. The fab zip is built only when requested. `pcbjs build` runs the same load and compile without the HTTP server, then writes the fab sets, `boards.json` and the static site.

The site is prerendered the way VitePress does it: the viewer is built for the browser and for Node from `packages/viewer/src/entry-server.ts`, every route is rendered into its own `index.html` with its data inlined, and the browser hydrates it into a single-page app. A page arrives readable and a static host serves every deep link without a fallback. View state comes from `createStore`, never module scope, so renders share nothing; the 2D and 3D views render only after hydration behind a placeholder of the board's shape. Prerendering needs an absolute base, because a page's links are written out in full; a relative base builds the plain client-rendered site.

## Validation plan

The example boards are not enough to trust the Gerbers. The plan: port a fabricated two-layer KiCad board with a pour and a few dozen nets, keeping its footprints and tracks; export Gerbers and drills from both and compare each layer as geometry, by a Clipper symmetric difference or a fine raster diff, expecting differences only in zone fill, thermals, text and arc segmentation; compare drill hits, tools, the netlist pad by pad and the placement file; check that pcbjs DRC finds every KiCad DRC error or lists the check as missing; then load the Gerbers in a third-party viewer and a fab's checker, and order the board. Known limits are in development.md.
