# Viewer

The Vue viewer that `pcbjs dev` serves and `pcbjs build` prerenders: the 2D view, the schematic view, the panels, multi-board sites and the view state.
The 3D view is in 3d.md; clicking through to the code is in editor.md.

## 2D view

- Every layer has its own colour. Click a layer in the rail to hide it, double-click to show it alone; the presets Front, Back, All and Copper set the whole list.
- Scroll to zoom, drag to pan.
- The grid behind the board is in board millimetres: 1 mm minor and 10 mm major lines, 0.1 and 1 mm zoomed in, 10 and 100 mm zoomed out, the minor step at least 8 screen pixels, the origin's axes a shade stronger. The grid button in 2D, 3D or the schematic turns it off in all three.
- Hovering copper outlines it and shows the coordinates, ref, pad and net. A routed track shows its net, width and length, and for a pair the skew, the target and whether the length is outside it.
- A pair is one object: hovering or pinning either net of a pair lights it in full, every track, via and pad, and its partner in full but fainter, routed as a pair or not. Past a series part, coupling capacitors or a renaming ESD array, the group spans both sides: the union of the `nets` of its pair routes. This holds in 2D, 3D, the schematic, the VS Code Nets list and the sync.
- Highlights in 2D are outlines over the board, never fills. In 3D a hover, a selection, a pinned net and the source highlight tint an item by its area: full strength up to 8 mm², a track of 0.3 mm by 25 mm, then 1 over the square root of the area over 8 mm², down to 0.15, so a pour gets a faint tint and a full outline. A part body tints down to 0.35 and has no outline.
- A selected part, pad or group, or a pinned net, shows on both sides of the board in 2D. In 3D the board turns semi-transparent instead: the substrate, the solder mask and every item that is not highlighted, so highlighted copper and parts on the far side show through, while the highlighted items stay opaque. Hover alone changes no opacity; the focus fade button turns this off, its popover in 3d.md sets the look.
- The ratsnest and DRC markers are drawn over the board. The header links the `.pcb.svg` document and the fab zip.
- With the focus fade on and a net pinned or a part, pad or group selected, a hover outside the focus, its pair group included, draws only that item's outline in 2D, 3D and the schematic, none for a 3D pour, and reaches nothing else: no net, part or schematic mark, no fill, no fade change. Inside the focus and on findings a hover works as always. A click outside still selects and so moves the focus.
- The 3D hover bubble and the source highlight chip follow the pointer in the same frame, with no transition.

## Schematic view

The Schematic button beside 2D and 3D shows the board's schematic drawing, see schematic-graphic.md, in the theme's colours.

- Scroll to zoom, drag to pan, F fits the drawing, as in 2D. The page is a slightly lighter surface on the canvas, under a grid of 2.54 mm minor and 25.4 mm major lines. Board shows the 2D view beside it, so a hover on either side shows on the other.
- The left rail lists Symbols, Wires, Labels, Power, Sheets, Texts and Findings with their counts: click a row to hide it, double-click to show it alone. Below it the sheet: the page size or the paper, grid, wired and labelled nets, junctions, crossings and wire length.
- Hovering a pin, wire or label highlights its whole net, here, in 2D and in 3D; hovering a symbol outlines its part on the board. A hover on the board marks the pin of a pad, the net and the symbol here.
- A click on a symbol or pin selects the part, as a click on the board does, and opens the code that drew it: the part element or `<Sym>` inside `<Schematic>`, or the part's placement for a symbol the compiler placed. A click on a wire or label pins its net and opens its `wire()` or `<Label>`; a click on a sheet's border selects the circuit instance.
- Highlights are halos under the drawing, never fills, except a selected symbol's tint, which fades by its body's area as the 3D tint does.
- Schematic findings, `layer: 'sch'`, list in the ERC tab with the board's; a click switches to the schematic, pans to the finding and pulses there. Their markers are drawn on the sheet, never on the board.
- In dev, moving the editor cursor into a part element or `<Sym>` inside `<Schematic>`, a `<Label>`, `<Power>`, `<Sheet>` or `wire()` chain outlines what it drew here and its parts on the board, see editor.md.

What the view does not do yet: it edits nothing, it has no search, and a hover in 3D marks only the net.

## Panels

- The left rail lists the layers, the board counts, the rules and the stackup: one row per physical layer, top to bottom, with type, name, thickness and weight, material or colour, then the finish, colours and total thickness.
- The tabs on the right are DRC, ERC, Schematic, BOM, Nets and Part.
- DRC and ERC list the findings, each with a pill and a board marker by severity: red error, amber warning, blue info. Info findings are counted apart and never count against the board. A click zooms to the finding.
- Schematic shows the circuit instance tree, or the flat parts on a board without circuits, with a filter.
- Part shows the selected footprint: value, footprint id, position, side, fields, its source range and the pad to net table. With a circuit instance selected it is the Circuit tab.
- BOM and Nets list the BOM rows and the nets. A net with a route shows the route length in mm, the target range after a slash when the route has one, and a red mark when the length is outside it. Several routes of one net add up; the hover text lists each.

## Multi-board sites

With several entries the site opens on a home page with one card per entry: a thumbnail, the name, title, revision, size, copper and part counts, a DRC pill counting every finding once, unconnected included, the fab zip and the entry path. An entry that fails to compile shows a red card with the first line of its error.

- With a single entry there is no home page. Routes are paths under the base: `/` the home page, `/board/<name>` a board, `/board/<name>/<slug>` one target of a board with variants. Old `#/board/<name>` links redirect once. Any other path shows "No such board".
- The top bar links back to all boards and switches boards from a dropdown.
- A board with variants is one card; its targets are a dropdown in the top bar.
- On a workspace dev server with several projects every path gets the project's slug in front, `/<scope>/board/<name>`, and `/` lists the projects: loaded ones with their boards and status, unloaded ones by name, stale ones marked. The top bar links back to the projects. See workspace.md.
- The page title is the board's title, or `pcbjs` with the board count on the home page.

## View state

Each board keeps its own view state while another board, target or mode is shown: the mode, hidden layers and schematic rows, the board beside the schematic, the pinned net, the selection, the flip, and the 3D fade and explode. The 2D view's Flip to back carries over: the 3D view opens on the bottom when the 2D view was flipped. The dev server and IDE mode open boards in 3D, a built site in 2D, unless the view query below says otherwise. A stored light or dark theme applies before the first paint.

## View query

A query on any board URL sets the view once, after the first render, so a prerendered page still hydrates as the server rendered it. Each board takes it the first time it shows.

| Parameter | Does |
| --- | --- |
| `view=2d`, `view=3d`, `view=sch` | open in that view |
| `explode=<0..1>` | open the 3D view exploded, at that fraction of the 15 mm separation; `0` closes it. Without `view` it opens 3D |
| `layer=<name>` | show one layer alone in 2D, the outline kept: a layer id such as `In1.Cu`, an alias such as `top`, `back` or `silk`, or the rail name, in any case |
| `select=<ref>` | select a part as a click on it would, Part tab included, and frame it: its courtyard with a margin fills the 2D view, the 3D camera looks at its body with the rest faded, the schematic centres its symbol |
| `side=bottom` | view the board from below: the 2D view flipped to the back, the 3D view opening on the bottom view, and a `select` framed from below; `side=top` is the default |
| `theme=light`, `theme=dark` | the theme for this page, not stored |

For example `/board/Blinky?view=3d&explode=0.4&select=Q1`. A layer or ref that matches nothing logs a warning in the console and is ignored.

## Loading states

In dev the page follows the server's `pcbjs:status` events: `starting`, `compiling` and `routing` with the entry, board, entries done and legs routed per round, and `idle`.

- First load: the mark, the board or project name and one line of status, such as `routing 21 legs, round 2`, with a spinner while in progress and a bar when the server reports one. The server inlines this screen and starts its first compile once a page asks or after 2 s.
- No board to show, as a workspace server with no project chosen: `Select a board file to get started`, no spinner, in IDE mode a hint naming the Boards view. A compile brings the status back.
- Recompile after an edit: the board stays, a 2 px line at the top shows the progress, and the status is in the header, in IDE mode in the pane's button row.
- Server gone: the same screen with the command to start it and its folder; the page retries every 2 s and reloads once it answers.

`boot-screen.js` and `boot.css` draw all of these and the VS Code pane's page: monotone, on dots that fade out around the centre, with slow waves of brighter dots, paused in a hidden tab, off under reduced motion.

## Canvas and theme

The 2D, 3D and schematic views share one background per theme, `--canvas` in style.css, so switching views never flashes. The board sits on `--substrate`, the schematic page on `--canvas-page`, and the grid uses `--grid-minor`, `--grid-major` and `--grid-origin`; the 3D scene and its fog read the same tokens.

## Shared hover and focus

Every viewer of one dev server, VS Code panes, browser tabs and the LAN viewer, shows the others' hover and focus on the same board. A hover elsewhere is drawn as a hover here, without the bubble, and goes when that pointer leaves; a pinned net, a selected part or group elsewhere becomes the focus here. A page that opens later gets the last focus at once, unless its URL has `select`. The editor cursor highlight keeps its own channel. A hover travels as `{ ids, refs, net }`, null when the pointer leaves, at most once a frame and only on change; a focus as `{ net, ref, refs, circuit }`; each viewer finds the pair group. ide-bridge.md has the messages.

## Ready signal

The page sets `data-ready` on `<html>` once the view shown has drawn: `2d` a frame after the board SVG is in the DOM at its size, `sch` a frame after the schematic is, `3d` after the first frame with every mesh built, the workers idle, the camera, tints and explode settled. A switch of view, board, target or explode clears it until the new view has drawn. The home page never sets it. `pcbjs shot` waits for it, see cli.md.

## Prerendered pages

A built site has one prerendered page per route, with the title, rails and tabs before any JavaScript runs and an outline of the board until the 2D view mounts. The browser hydrates it without fetching anything, then moves between pages by the history API. A static host without a fallback, such as GitHub Pages, serves every deep link. Prerendering needs an absolute `base`, `/` by default; a relative base builds a client-rendered site. `pcbjs preview` answers unknown paths with `404.html`. See cli.md for the files.

## Dev server paths

| Path | Content |
| --- | --- |
| `/__pcbjs/<name>/board.json` | the compiled board as the viewer gets it; large, prefer `inspect` |
| `/__pcbjs/<name>/<name>.pcb.svg` | the board SVG |
| `/__pcbjs/<name>/fab/<file>` | one fab file, the zip built on request |
| `POST /__pcbjs/cursor`, `/__pcbjs/open`, `/__pcbjs/ide` | the editor bridge, see ide-bridge.md |

A board with variants takes the slug after the name. The paths without `<name>/` answer for the first board. The site routes are `/`, `/board/<name>` and `/board/<name>/<slug>`.
