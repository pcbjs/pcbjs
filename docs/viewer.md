# Viewer

The viewer served by `pcbjs dev` and prerendered by `pcbjs build`: selection, views, panels and board state.
Advanced. 3D: 3d.md. Highlight: highlight.md. Source navigation: editor.md. Keys: keys.md. Components: ui.md.

```text
/board/Blinky?view=3d&explode=0.4&select=Q1
```

## View query

Applied once per board after first render; unknown names warn.

| Parameter | Does |
| --- | --- |
| `view=2d`, `view=3d`, `view=sch`, `view=checks` | open in that view; dev, IDE and embed mode default to 3D, a built site to 2D |
| `explode=<0..1>` | 3D exploded at that fraction of 15 mm; `0` closes it; opens 3D without `view` |
| `layer=<name>` | one layer alone in 2D, outline kept: an id, `In1.Cu`, an alias, `top`, or the rail name, any case |
| `select=<ref>,<ref>` | select and frame what references of refs.md name, the first the anchor; a finding is also focused. The selection follows into the URL |
| `isolate=<group>` | isolate a named `<g>` or an instance, its definition shown with its values |
| `side=F`, `side=B` | the side on top in 2D, unmirrored; `B` also opens 3D on the bottom view; `F` is the default |
| `mirror=1`, `mirror=0` | the 2D view mirrored left to right, off by default |
| `theme=light`, `theme=dark` | the theme, unstored |

## Selection

Each board has one selection, shared by dev session, views, tree and editor; built sites and embeds hold their own. It contains refs, the last-clicked/added anchor and isolation. Hierarchy: board, named `<g>`/instances, part, pad. Routes belong to their layout instance, with legs `route:3/leg:k` and points `route:3/pt:k` beneath them.

| Under the pointer, 2D and 3D | A click selects | The editor goes to | Context | Tools |
| --- | --- | --- | --- | --- |
| part body or pad | the part, `J1` | its `at` | none | move, ring, `R`, flip |
| pad with cmd, ctrl off macOS | the pad, `J1/2` | the part's `at` | its net | none |
| part of an instance | the instance, `CH2`: its parts, routes and silk | its layout element's `at` | none | move, ring, `R`, flip |
| part of the selected instance | enters its definition, `CH2/R` selected | the layout element | none | move, ring, `R`, flip |
| track or via | its route, `route:trunk` | the chain call | its net, pair mate | points, leg handles |
| automatic leg with cmd | the leg, `route:trunk/leg:1` | the chain call | its net | leg handle |
| pour | `plane:B.Cu:GND` | its `pour()` | none | none |
| text or graphic | its `item:` | its element | none | move, ring: a text with its own element |
| ratsnest line | its net, `net:U` | the net's declaration | the net | none |
| finding dot or line | the finding, its tab opened | its first witness | none | none |
| route end, assist dot | nothing; writes the slot, editing.md | the slot | | |
| empty board | no members; instance context closes, library context stays | | | |

| Schematic | A click selects | The editor goes to |
| --- | --- | --- |
| symbol | the part, or its instance at the board level | its `at` in `<Schematic>` |
| pin | the part, with cmd the pad | the part's `at` in `<Schematic>` |
| wire or label | the net | its declaration |
| sheet | the instance | its `<Sheet>` |

- Hover lights what a click would select, with cmd a deep-select, nothing more. The readout names the item, pad, net and route.
- A click makes one selection, one editor jump, one chip. Only a copper anchor draws context; an item lights its own copper.
- Shift toggles selection; alt/option opens its definition without changing selection. Double-click: instance part enters its definition with part selected; part selects pad; route selects nearest point. Escape ascends within a definition, leaves with instance selected, goes to an enclosing nested definition, then clears.
- Tools show under the chip for a placed anchor in a read-write session, else why not, editing.md.
- The chip shows the anchor path `Group1/R1/2`, selectable prefixes, other selected members and view state. Findings show their type only; full messages belong in the checks viewer. The `I` shortcut toggles isolation; group-layout actions sit below the badges. Write feedback reports success or refusal.
- Isolate or `I` limits visibility to the focused group or standalone footprint. Instance layout edits retain the board context and close on part blur. Library layout edits show the independent template at its own origin, borrowing parameter values where necessary, with independent numbering. A footprint can be isolated but cannot enter library layout editing. See editing.md.
- An older session says `session <version> is older than the viewer`.

## 2D view

| Action | Result |
| --- | --- |
| click a layer in the rail | hide it; double-click shows it alone; presets Front, Back, All, Copper |
| scroll, drag | zoom, pan |
| hover | what a click would select, coordinates, net; a track adds width, length, skew and target |
| grid button, `G` | grid off in 2D, 3D and schematic |
| ratsnest button, `N` | the ratsnest and the connection indicators off in 2D and 3D |
| front and back buttons | the side on top, as KiCad's high contrast does |
| mirror button | mirror the view left to right |

- The active side draws over the inner layers and the far side; back silk reads mirrored. Side and mirror go into the URL.
- Grid steps: 0.1 to 100 mm by zoom, minor at least 8 px.
- A pair is one object: the anchor's net draws its partner as context.
- The focus fade, on unless turned off in 3D, fades what is not selected, highlight.md.
- A finding is a dot in its severity colour, info hollow, ERC a diamond; hover shows only its rule name, a click selects, focuses and frames it. An `unconnected` or `route-failed` one is its line, labelled in the DRC tab or when hovered or focused, marching when focused.
- Unrouted connections use a start-to-end layer-colour gradient, active-side dot and far-side ring.
- `/` opens the palette, `?` the key map. Dialogs own focus and shortcuts until dismissal, then restore focus.

## Schematic view

Schematic shows schematic-graphic.md's drawing in theme colours.

- Scroll, drag, F fits. Grid 2.54 and 25.4 mm. Board shows the 2D view beside it.
- The rail lists Symbols, Wires, Labels, Power, Sheets, Texts and Findings: click hides, double-click solos.
- Hover/click follow Selection: board parts mark symbols, pads mark pins, nets mark wires.
- Highlights are halos, a selected symbol tinted.
- Findings with `layer: 'sch'` list in the ERC tab, marked on the sheet only; a click pans there and pulses.

Not yet: no editing, no search.

## Panels

| Place | Shows |
| --- | --- |
| left rail | layers, board counts, rules, the stackup layer by layer with finish and total |
| DRC, ERC | findings with pill, marker and refs, the id on hover; a click focuses it and zooms, a recompile keeps it by fingerprint |
| Schematic | the circuit instance tree, or flat parts, with a filter |
| BOM, Nets | rows and nets; a routed net shows length in mm, `/` target, a red mark outside it |
| Part | value, footprint id, position, side, fields, source range, pad to net; Circuit with an instance selected |

## Multi-board sites

- Multiple entries get home cards with thumbnail, counts, DRC pill and fab zip; variants share a card.
- Routes: `/` home, `/board/<name>`, `/board/<name>/<slug>` for a variant target; a single entry has no home. A workspace server prefixes `/<scope>/`, workspace.md.
- The top bar links home, board choices, `.pcb.svg` and fab zip; with an editor, choosing opens its entry on `<PCB`.

## View state

- Each board keeps its mode, hidden layers, selection, side, mirror, fade and explode while another is shown.
- Stored theme applies before first paint.

## Loading states and the live board

Dev streams facets as stages finish: `pcbjs:facet { board, target, run, facet, stage, hash, data }`. Loading ends at first `meta`; older held-kind facets are dropped. A successful cached run may reuse unchanged facet hashes without resending their payloads. Completion follows its idle status; clients retain matching data until a changed facet replaces it.

| Facet | After | Holds |
| --- | --- | --- |
| `meta`, `model` | place | board, rules, outline, parts, pads, airwires; each part's model and fit |
| `layers`, `shapes` | place, tune without fills, finish | layer markup, item rows, sources, routes; item rings |
| `sch` | schematic | the netlist and its drawing |
| `findings` | checks | DRC, ERC, the ratsnest, the counts |
| `fab` | exports | fab set, BOM and times |

- An edit first sends `pcbjs:invalidate { run, refs, uids, findings, edit }`: what it makes stale is half-opaque, unpickable, until a newer facet remakes it, no facet up to run `edit` taken. A `layers` facet with `partial { replaces }`, session.md's keystroke tier, draws the edited entity in their place.
- `pcbjs:status` streams `{ run, stages: [{ name, state, ms, units? }] }`, state `stale`, `running`, `done` or `hit`: a spinner, a bar, a segment per stage; `phase: 'cancelled'` when an edit stopped it.
- Mounted views demand facets, session.md: 2D `meta`, `layers`, `findings`, plus `shapes` for assist; 3D also `shapes`/`model`; schematic `meta`/`sch`, plus 2D when split; checks `meta`/`findings`, no meshes. `?ide=1&view=` loads only that view's `@pcbjs/ui` entry.
- `session/state` every 5 s gives run and facet hashes. Missing `seq`, mismatched hashes or invalidating absent data refetches with "View resynced after falling out of sync" and Report; three per minute show Reload.
- The first load shows a status line `routing 21 legs, round 2`.

## Canvas and theme

All views share `--canvas` from style.css per theme, the board on `--substrate`, the page on `--canvas-page`, the grid `--grid-minor`, `--grid-major`, `--grid-origin`; 3D reads the same tokens.

## Shared hover and selection

Viewers share hover and selection unless their URL has `select`. Hover is `{ uids, refs, net }` at most once a frame; the selection `pcbjs:select` `{ board, selection }`, last writer wins.

## Embedding

`/board/<name>?embed=1` fills an iframe, 3D unless `view` overrides; query, keys, hover and click work. `tools=0` hides toolbars, scale and readout. Components: ui.md.

The frame accepts parent messages below plus `pcbjs:net`/`pcbjs:finding`, ide-bridge.md. Optional `board`/`target`: null target selects first; omission keeps current or remembered target. Unknown identities refuse with a message.

| Message | Does |
| --- | --- |
| `{ type: 'pcbjs:view', view?: '2d' \| '3d' \| 'sch' \| 'checks', side?: 'F' \| 'B', mirror?: boolean }` | switch the view, the side on top or the 2D mirror, any one at least |
| `{ type: 'pcbjs:theme', theme: 'light' \| 'dark' }` | switch the theme, unstored |
| `{ type: 'pcbjs:hover', uids, refs, net }` | draw a hover as another viewer's is drawn; empty arrays and a null net clear it |
| `{ type: 'pcbjs:select', refs, frame? }` | select references as `select` does, the first the anchor, null or empty clears; frame only with `frame: true` |

Posts to `window.parent`, target origin `*`: `pcbjs:ready` `{ board, views }` once a view has painted; `pcbjs:hover` `{ uids, refs, net }`; `pcbjs:select` `{ refs, anchor }`; `pcbjs:view` `{ view, side, mirror }` after a switch; in dev `pcbjs:facet` `{ board, target, facet, run, stage }`.

## Ready signal

`data-ready` on `<html>` once the view has drawn: `2d` a frame after the board SVG is sized, `sch` a frame after the schematic, `3d` after every mesh is built and the camera, tints and explode settle. The checks view sets `checks` after its HTML details render. Switching clears it; home never sets it.

## Prerendered pages

Routes prerender and hydrate without fetching. Static deep links require an absolute `base`, default `/`.

## Dev server paths

`/__pcbjs/<name>/board.json`, prefer `inspect`; `/__pcbjs/<name>/<name>.pcb.svg`; `/__pcbjs/<name>/fab/<file>`, the zip built on request; `/__pcbjs/open` and `/__pcbjs/ide`, ide-bridge.md. A variant target takes its slug after the name.

## DRC/ERC viewer

The fourth view, `?view=checks`, shows structured diagnostic details with an expandable findings list and previous/next buttons. Selection is the board's shared finding state, so navigation updates connected views without reopening the viewer. Source focus or clearing selection keeps it open. Copy as Markdown uses the icon-only toolbar action; references support click, Ctrl/Command multiselect and text-range selection. Full diagnostic sentences are confined to this view; schematic, 2D and 3D show only error types.

Focus-driven fitting is temporary in 2D, 3D and schematic views. The first fit saves that view's pan and zoom, plus the 3D camera orientation. Moving between findings retains the original checkpoint. Clearing focus restores it, including after manual navigation or switching away and back. In 3D, the return animates orbit, position and zoom with the same spring motion as focusing, lands exactly on the saved pose, and yields immediately to manual camera input or a new focus. Reduced-motion preferences make both directions immediate. Resizing the pane preserves the saved center and zoom scale while adapting to the new viewport. A finding inside an isolated layout has its own checkpoint: Escape first restores the isolated view, then leaving isolation restores the earlier board view. Ordinary hover and caret selection do not create camera checkpoints.

## Selection ordering and recovery

The session orders incoming selection intents before loading a library layout. A later selection, cancellation or target change supersedes an older pending library selection. A compile during loading retries against the latest geometry without restoring cancelled focus. Stale acknowledged bases do not cancel newer intents. Refs-form target changes start with an empty target context, clearing old finding focus, isolation and snapshot identity before validating the new references. If the server rejects an optimistic selection, the originating viewer restores its last acknowledged selection and displays the refusal; a late rejection cannot roll back a newer local or server selection.
