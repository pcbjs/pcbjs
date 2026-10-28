# Viewer

The Vue viewer that `pcbjs dev` serves and `pcbjs build` prerenders: the 2D view, the schematic view, the panels, multi-board sites and the view state.
The 3D view is in 3d.md; clicking through to the code is in editor.md.

```text
/board/Blinky?view=3d&explode=0.4&select=Q1
```

## View query

Set once after the first render, so a prerendered page hydrates as served; each board takes it the first time it shows. A layer or ref that matches nothing warns in the console.

| Parameter | Does |
| --- | --- |
| `view=2d`, `view=3d`, `view=sch` | open in that view; dev and IDE mode default to 3D, a built site to 2D |
| `explode=<0..1>` | 3D exploded at that fraction of 15 mm; `0` closes it; opens 3D without `view` |
| `layer=<name>` | one layer alone in 2D, outline kept: an id such as `In1.Cu`, an alias such as `top`, `back` or `silk`, or the rail name, any case |
| `select=<ref>` | select and frame a part: courtyard with margin in 2D, its body with the rest faded in 3D, its symbol centred in the schematic |
| `side=bottom` | from below: 2D flipped, 3D on the bottom view; `side=top` is the default |
| `theme=light`, `theme=dark` | this page's theme, not stored |

## 2D view

| Action | Result |
| --- | --- |
| click a layer in the rail | hide it; double-click shows it alone; presets Front, Back, All, Copper |
| scroll, drag | zoom, pan |
| hover copper | outline, coordinates, ref, pad, net; a track adds width and length, a pair skew, target and whether it is outside |
| grid button | grid off in 2D, 3D and schematic |

- Grid in board mm: 1 and 10 mm lines, 0.1 and 1 zoomed in, 10 and 100 zoomed out, minor step at least 8 px, origin axes stronger.
- A pair is one object: hovering or pinning either net lights it in full and its partner fainter. Past a series part, coupling capacitors or an ESD array the group is the union of the `nets` of its pair routes, in 2D, 3D, schematic, the VS Code Nets list and the sync.
- 2D highlights are outlines, never fills. 3D tints by area: full up to 8 mm², then 1 over the square root of area over 8 mm², down to 0.15; a part body down to 0.35 with no outline.
- A selection or pinned net shows on both sides in 2D; in 3D everything not highlighted turns semi-transparent. Hover alone changes no opacity. The focus fade button turns this off, see 3d.md.
- With focus fade on and a focus set, a hover outside the focus and its pair group draws only that item's outline, none for a 3D pour. A click outside still moves the focus.
- Ratsnest and DRC markers draw over the board. The header links the `.pcb.svg` and the fab zip. The 3D bubble and the highlight chip follow the pointer with no transition.

## Schematic view

The Schematic button shows the drawing of schematic-graphic.md in the theme's colours.

- Scroll, drag, F fits. Page grid 2.54 and 25.4 mm. Board shows the 2D view beside it, hovers shared.
- The rail lists Symbols, Wires, Labels, Power, Sheets, Texts and Findings: click hides, double-click solos. Below: page size or paper, grid, wired and labelled nets, junctions, crossings, wire length.
- Hover a pin, wire or label: its net everywhere; a symbol: its part on the board. A board hover marks the pin, net and symbol here.
- Click a symbol or pin: select the part and open its part element, `<Sym>` in `<Schematic>`, or placement. Click a wire or label: pin its net and open its `wire()` or `<Label>`. Click a sheet border: select the instance.
- Highlights are halos, except a selected symbol's area tint.
- Findings with `layer: 'sch'` list in the ERC tab; a click pans there and pulses. Their markers are on the sheet only.
- The editor cursor in a part element, `<Sym>`, `<Label>`, `<Power>`, `<Sheet>` or `wire()` outlines what it drew, see editor.md.

Not yet: no editing, no search, a 3D hover marks only the net.

## Panels

| Place | Shows |
| --- | --- |
| left rail | layers, board counts, rules, stackup: one row per layer with type, name, thickness, weight, material or colour, then finish, colours, total |
| DRC, ERC | findings with a pill and marker: red error, amber warning, blue info, info counted apart; a click zooms |
| Schematic | the circuit instance tree, or flat parts, with a filter |
| BOM, Nets | rows and nets; a routed net shows length in mm, `/` target, a red mark outside it; several routes add up |
| Part | value, footprint id, position, side, fields, source range, pad to net; Circuit with an instance selected |

## Multi-board sites

- Several entries open on a home page with a card per entry: thumbnail, name, title, revision, size, copper and part counts, a DRC pill counting each finding once, the fab zip, the entry path. A failed entry shows a red card with its first error line.
- Routes: `/` home, `/board/<name>`, `/board/<name>/<slug>` for a variant target. A single entry has no home. Old `#/board/<name>` links redirect once; other paths show "No such board".
- The top bar links home and switches boards; a board with variants is one card with targets in a dropdown.
- A workspace server prefixes `/<scope>/` and lists projects at `/`, see workspace.md.
- The page title is the board's title, or `pcbjs` with the count on the home page.

## View state

- Each board keeps its mode, hidden layers and rows, the board beside the schematic, pinned net, selection, flip, and 3D fade and explode while another is shown.
- Flip to back in 2D opens 3D on the bottom. A stored theme applies before the first paint.

## Loading states

In dev the page follows `pcbjs:status`: `starting`, `compiling` and `routing` with entry, board, entries done and legs per round, and `idle`.

| State | Shows |
| --- | --- |
| first load | mark, name, a status line such as `routing 21 legs, round 2`, spinner or bar; inlined, first compile on a page request or after 2 s |
| nothing to show | `Select a board file to get started`; in IDE mode a hint naming the Boards view |
| recompile | board stays, a 2 px progress line, status in the header or the IDE pane's button row |
| server gone | the start command and folder; retries every 2 s and reloads |

`boot-screen.js` and `boot.css` draw these and the VS Code pane's page, animated dots paused in a hidden tab and off under reduced motion.

## Canvas and theme

All views share `--canvas` from style.css per theme. The board sits on `--substrate`, the schematic page on `--canvas-page`; the grid uses `--grid-minor`, `--grid-major` and `--grid-origin`, and 3D and its fog read the same tokens.

## Shared hover and focus

Every viewer of one dev server shows the others' hover, without the bubble, and focus on the same board; a page opened later gets the last focus unless its URL has `select`. A hover is `{ ids, refs, net }` or null, at most once a frame and on change; a focus is `{ net, ref, refs, circuit }`. The cursor highlight has its own channel, see ide-bridge.md.

## Ready signal

`data-ready` on `<html>` once the view has drawn: `2d` a frame after the board SVG is sized, `sch` a frame after the schematic, `3d` after every mesh is built and the camera, tints and explode settle. A switch clears it; the home page never sets it. `pcbjs shot` waits for it.

## Prerendered pages

One page per route with title, rails, tabs and a board outline before JavaScript; it hydrates without fetching, then navigates by the history API, so a static host without a fallback serves deep links. It needs an absolute `base`, `/` by default; a relative base builds a client-rendered site. `pcbjs preview` answers unknown paths with `404.html`.

## Dev server paths

| Path | Content |
| --- | --- |
| `/__pcbjs/<name>/board.json` | the compiled board; large, prefer `inspect` |
| `/__pcbjs/<name>/<name>.pcb.svg` | the board SVG |
| `/__pcbjs/<name>/fab/<file>` | one fab file, the zip built on request |
| `POST /__pcbjs/cursor`, `/__pcbjs/open`, `/__pcbjs/ide` | the editor bridge, see ide-bridge.md |

A board with variants takes the slug after the name; paths without `<name>/` answer for the first board.
