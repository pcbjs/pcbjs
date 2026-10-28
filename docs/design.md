# Design

Why pcbjs is built the way it is: SVG as vocabulary, JSX without React, the schematic layer, the compile passes, and how a board is checked.
Read it before changing the compiler; the user reference is the other topic files.

```ts
// what jsx() returns: a plain node, no React, no reconciler
const node = { $$: 'pcb', type: 'rect', props: { layer: 'Edge.Cuts', w: 40, h: 12 }, children: [] }
```

## SVG is the vocabulary, not the model

- pcbjs borrows SVG's words, `d` path data, `<g>`, `<rect>`, `<circle>`, `<line>` and nested transforms, because many people read them.
- SVG has no nets, pads, drills, stack or rules, a stroke is only a hint, and a flip to the back swaps every `F.*` layer for its `B.*` twin, which no transform expresses.
- The canonical model is the compiled `Board` in `src/model.ts`: a flat list of pads, tracks, vias, zones, graphics and text in absolute mm, each with layer, net and footprint. Every exporter reads it; `<name>.pcb.svg` is one export with `pcb:` metadata, never parsed back. The TSX stays the source of truth.

## JSX without React

- `jsx()` returns a node `{ $$: 'pcb', type, props, children }`. A component is a pure function called once during flatten; the board recompiles on every change.
- The JSX types come from `types.ts`, so a misspelled prop fails in the editor; `jsxDEV` records where each element starts.

## The schematic layer

- Nets are values, because a string `GDN` is quietly a new net. `nets()` hands out `Net` objects through a proxy, a factory with a value gives a `Part`, and `.connect(...)` checks pin names in TypeScript and counts at runtime. Strings stay as the escape hatch; `strictNets` turns them off.
- Refs are not written. A per-process registry numbers parts at creation and flatten numbers placed parts per prefix in that order, after explicit refs, so they follow the schematic. Parts render with a placeholder ref rewritten once every part is known.
- The registry is on `globalThis` and knows parts and nets by their `$$` brand, since the CLI's pcbjs compiles what Vite's SSR copy created. Each part keeps its file through Vite's source maps; a re-evaluated module replaces its parts, and a module-level part of a file that placed parts but not it is an ERC error. ERC findings share the DRC marker shape.
- A circuit is a build function from ports to parts by key, typed so `Buck1.R1` checks. Private nets are scoped to the instance, named from its path once its key is known. Ports are the only way across, enforced at `connect`. Refs stay flat for fabs and silk; the hierarchy is `path` and `local` in the netlist.
- A layout wraps its output in a marked group, so one circuit can have several, two layouts of one instance are rejected, and many `unplaced-part` errors fold into one `unplaced-circuit`.

## Sourcing

A part carries `MPN` and `MPN:<tag>`; a board or fab target has an ordered tag list resolved like any setting, and each BOM row takes the first tag it has, else `MPN`. `source()` modules merge under the part's own keys, scoped through the entry's module graph so they never reach later boards.

## Compile passes

| # | Pass | What |
| --- | --- | --- |
| 1 | Load | Vite's SSR loader imports the entry, adds source ranges, transforms TSX with esbuild; entries share only the module graph |
| 2 | Flatten | call components, compose `at` and side flips, resolve layers, map `net:*` to pads by number then pin name, `net:pad1` for pad 1; placeholder refs, pad nets, numbering, netlist, ERC; errors carry the source |
| 3 | Outline | chain `Edge.Cuts` into closed rings |
| 4 | Schematic | `compile/sch.ts` places symbols, checks hand wires, wires the rest in the router's square mode, `sch-route.ts`; see schematic-graphic.md |
| 5 | Autoroute | every `route()` and track whose `d` is an `AutoRoute`, a `RouteFn` or omitted becomes a job once the tree and outline are known; legs run by `priority` and document order through a `RouteContext`, with `maze`, `straight` or a custom `RouteFn`, each an obstacle for the next |
| 6 | Zone fill | by priority: clip to the outline inset by `edgeClearance`, subtract other-net copper and holes by `holeClearance`, open by `zoneMinWidth`, drop islands; Clipper; pours are no obstacle to routes |
| 7 | Connectivity | union-find per copper layer, each pour piece its own item; overlapping nets are shorts; candidates from the grid in `compile/spatial.ts`, shared with DRC and zone fill; ratsnest by greedy nearest pair |
| 8 | DRC | findings.md, then `route-failed` and `keepout`; `board.timings` has each phase's time |
| 9 | Export | per-layer SVG, `<name>.pcb.svg`, Gerber X2, job file, Excellon, BOM, placement, `README-fab.txt`, zip |
| 10 | Site data | layers, footprints, stackup, DRC, ERC, netlist, ratsnest, BOM, source index |

Routing details:

- A failed leg is a `route-failed` finding with its nearest obstacles, so it hides no other leg; `<PCB strict>` throws instead.
- Legs are cached by request and nearby obstacles in `.pcbjs/routes/<board>.json`; `.lock()` pins a route.
- A pair routes its centre line as one wide track, which `compile/pair.ts` offsets into two tracks with fans and via pairs. `compile/tune.ts` then tunes skew, `.length()` and `.match()`, a pure function of the routed board.
- `variants()` boards route once under their targets' strictest rules. autorouter.md has the rest.

## Source ranges

`packages/cli/src/source-ranges.ts`, a Vite transform before esbuild, adds a `__src` prop with the full range to every JSX element and every `route`, `pour` and `via` call. Flatten keeps it as the item's `src` and the enclosing calls as `chain`, outermost first; `sourceIndex` in `packages/export/src/site-data.ts` nests ranges per file with their item ids and refs.

## The 3D view

- `items` from `packages/export/src/items.ts` carries every item as rings in board mm with id, kind, layers, net, ref and drill, holes by the sign of their area. Ids are the model's, so a range, a click and a DRC item meet on one number.
- `packages/viewer/src/scene/items.ts` extrudes a mesh per item and layer, caching by ring and sharing materials. A group per physical layer makes explode a z offset.

## The IDE bridge

The editor link rides the dev server's HMR WebSocket and a few HTTP paths, found through `.pcbjs/dev.json`. The VS Code extension in `packages/vscode` installs with `pcbjs ide install`; ide-bridge.md has the protocol.

## The dev loop

1. Vite's watcher sees a change outside `.pcbjs` and `node_modules`.
2. The plugin returns no modules to HMR, so the page never reloads. It walks the SSR graph up to the entries reaching the file, adds boards whose last compile failed, and compiles after 60 ms of quiet; a file outside the graph schedules every board.
3. Each board's site data goes out as `pcbjs:board`, then `pcbjs:boards` with per-entry errors; the viewer keeps zoom, hidden layers and selection.
4. A failed compile sends `pcbjs:error`, shown over the last good board.

- Boards are keyed by `name`: `/__pcbjs/<name>/` in dev, `fab/<name>/` and `boards/<name>.json` in the site. The fab zip is built on request. `pcbjs build` runs the same compile, then writes fab sets, `boards.json` and the site.
- The site is prerendered as VitePress does: built for the browser and for Node from `packages/viewer/src/entry-server.ts`, each route an `index.html` with its data, hydrated into a single-page app. View state comes from `createStore`; 2D and 3D render after hydration. Prerendering needs an absolute base; a relative base builds a client-rendered site.

## Validation plan

Port a fabricated two-layer KiCad board with a pour and a few dozen nets; compare each Gerber layer as geometry by Clipper symmetric difference or raster diff, expecting differences only in zone fill, thermals, text and arcs; compare drill hits, tools, the netlist pad by pad and placement; check pcbjs DRC finds every KiCad error or lists the check as missing; load the Gerbers in a third-party viewer and a fab's checker; order the board. Known limits are in development.md.
