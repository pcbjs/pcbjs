# Advanced

Every topic beyond a first board, grouped by what you are doing, one line each.
Advanced. basics.md walks a first board; each topic here assumes it.

## Design

- circuits.md: circuits with ports, instance indices and refs, layouts.
- footprints.md: your own footprints with `defineFootprint`, and the typing rules for pin and pad names.
- schematic-graphic.md: the schematic drawing, symbols, wires, automatic wiring, `sch-*` findings.
- sourcing.md: `MPN` keys, `.source()`, sourcing tags, BOM resolution.
- stdlib.md: every footprint family of `@pcbjs/lib` with pins and frame, and the footprint helpers.
- placement.md: `auto` slots in `at`, the placer, `at:cost` and `at:solver`, followers beside routed copper, `pcbjs place --write`.
- grids.md: `defineGrid`, grid units under `<PCB grid>` and `<g grid>`, origins on pads and footprint points, schematic grids, `grid-cycle`.
- stackup.md: the stackup, its builders and fab stackups, and project-wide defaults.
- fonts.md: stroke and outline fonts for `<text>`, sizes, and their licences.

## Copper

- pours.md: pour fill, thermal reliefs, islands, `stitch()` stitching vias.
- route-options.md: builder methods, teardrops, autoroute parameters, net classes.
- autorouter.md: layers, vias, order and rip up, failures, keepouts, cache and holds, variants.
- pairs.md: differential pairs, gap, impedance, via pairs, pair DRC.
- length.md: length targets, match groups and meanders.
- patches.md: moves, vias, widths, reroutes and holds by reference, `pcbjs patch hold`.

## Checks

- rules.md: rule values, overrides per pad, part and net, fab rule sets.
- findings.md: every DRC and ERC rule with its severity, finding ids and fingerprints, what makes a board orderable.
- refs.md: the reference grammar every surface names things with.
- testing.md: board tests and golden fab sets.

## Output

- fab.md: fab presets, `bindPCB`, one design for several fabs with `variants`.
- references.md: another board as a mechanical reference: mate, stack, collisions.
- 3d.md: the 3D view, generated part models, the model cache.
- models.md: `pcbjs model add`, align and check, where to find model files and their licences.

## Tools

- cli.md: every command and flag, the `--json` report, a live session.
- inspect.md: every `pcbjs inspect` query and its output.
- viewer.md: the 2D and schematic views, panels, multi-board sites.
- editing.md: the viewer's tools, move, rotate, side and control points, snapping, and what each drag writes into the source or a patch.
- keys.md: every key and pointer gesture of the viewer, from the one table the views and the command palette read.
- ui.md: `@pcbjs/ui`, the views, chip, findings list and panels as Vue components, and the `?pcb:` imports of `@pcbjs/cli/vite` for a site of your own.
- render.md: `pcbjs shot` and `session/render`: views, cameras, framing, highlight and marks.
- diff.md: `pcbjs diff <ref>`, the board against a git commit as tinted images, and the pull request comment.
- vscode.md: the VS Code extension in depth: attaching, sidebar, commands, settings, drafts.
- highlight.md: what the cursor and hover pick, and source ranges.
- session.md: the one process `pcbjs dev`, the editor and agents share.
- workspace.md: one session for several projects.
- queries.md: `pcbjs events`, `q`, `script` and the board API.
- skills.md: the agent skills of `@pcbjs/skills`, and the MCP server, language server and hooks `skills install` registers.
- mcp.md: `pcbjs mcp`, the tools, messages and resources an agent gets.
- lsp.md: `pcbjs lsp --stdio` and its setup in Neovim, Helix, Zed, JetBrains and Claude Code.
- plugins.md: compiler plugins: stages, hooks and checks.
- browser.md: the compiler in a Web Worker, what of it runs in a browser, and its equality with Node.
- library.md: a project as an npm package of parts, circuits and boards with `pcbjs build --lib`, its boards referenced by package, and `compose()`.
- kicad.md: what carries over from KiCad and what does not.

## Background

- stackup-and-rules.md: why the stackups and rule values are what they are, with sources.
- ide-bridge.md: the protocol between the session and an editor.
- design.md: why pcbjs is built the way it is.
- development.md: working on pcbjs itself: packages, build and tests.
- support.md: what is supported, partial and missing, with the test or the gap behind each.

## Examples

The advanced examples under `examples/`, each listed in its README with what it demonstrates; basics.md has the three of the basic path.

- `demo`: Quad on four layers and Multi, one design for three fabs with `variants`.
- `highspeed`: differential pairs, impedance and a length matched bus.
- `usb-hub`, `usb3-hub`, `eth-phy`, `lvds-camera`, `sdram`: pairs, match groups and dense autorouting on review boards.
- `psu`: power pours, thermal maps, the placer and followers.
- `motor-stack`: three boards sharing a library, a circuit laid out three times and a jig made with `reference()`.
- `library`: a project published with `pcbjs build --lib` and a carrier that uses it.
- `badge`, `led-matrix`, `sensor-hat`, `stm32-dev`, `esp32-sensor`, `usbc-led`: outlines, circuits per pixel, model files and two fab targets.
