# Support matrix

What pcbjs supports, supports in part and does not do yet, with the test or the gap behind each, generated from the feature catalogue of the site.
Advanced. Each row is a file under `site/features/`, shown at https://pcbjs.dev/features; `node site/scripts/features.mjs --write` regenerates this file, and a test fails when it differs.

63 supported, 11 partial, 22 missing. Supported names the test that covers it, partial what is still open, missing is on the roadmap.

## Design

| Feature | Support | Evidence |
| --- | --- | --- |
| A board is a TSX module | supported | `packages/pcbjs/tests/compile.test.mjs` |
| A standard library of footprints | supported | `packages/pcbjs/tests/lib-footprints.test.mjs` |
| Automatic placement and followers | supported | `packages/pcbjs/tests/placement.test.mjs` |
| Circuits with ports and indexed instances | supported | `packages/pcbjs/tests/circuit.test.mjs` |
| Compiler plugins | supported | `packages/pcbjs/tests/pipeline.test.mjs` |
| Elements, shapes and text | supported | `packages/pcbjs/tests/shapes.test.mjs` |
| Named groups | supported | `packages/pcbjs/tests/group.test.mjs` |
| Nets and parts as values | supported | `packages/pcbjs/tests/schematic.test.mjs` |
| Sourcing and the BOM | supported | `packages/pcbjs/tests/sourcing.test.mjs` |
| Stackups and project defaults | supported | `packages/pcbjs/tests/stackup.test.mjs` |
| The binding name is the ref | supported | `packages/pcbjs/tests/bound-refs.test.mjs` |
| Your own footprints, typed pins | supported | `packages/pcbjs/tests/pad-spelling.test.mjs` |
| A drawn schematic, placed and wired for you | partial | Placement polish open: series parts sit beside one symbol, adjacent supplies can overlap their labels. |
| Another board as a mechanical reference | partial | Referenced slots retain their length and orientation in collision checks; the site leaves referenced boards out of 3D. |
| Named placement grids | partial | Grid units cover part and group positions only; routes, vias and text stay in mm. |
| Stroke and outline fonts | partial | No synthetic bold or italic: an outline style needs its own font file, and stroke text has no slant. |
| Synthetic bold and italic text | missing | planned |

## Routing

| Feature | Support | Evidence |
| --- | --- | --- |
| Route by hand, or leave a leg to the router | supported | `packages/pcbjs/tests/route-chain.test.mjs` |
| Copper on no net | supported | `packages/compile/tests/netless.test.mjs` |
| Custom routers and solvers | supported | `packages/pcbjs/tests/placement.test.mjs` |
| Differential pairs with impedance | supported | `packages/pcbjs/tests/pair-route.test.mjs` |
| Edits by reference | supported | `packages/pcbjs/tests/patches.test.mjs` |
| Keepouts with exceptions | supported | `packages/compile/tests/route-findings.test.mjs` |
| Route cache and holds | supported | `packages/compile/tests/route-cache-draft.test.mjs` |
| Stitching vias | supported | `packages/compile/tests/stitch.test.mjs` |
| Widths, teardrops and net classes | supported | `packages/compile/tests/teardrop.test.mjs` |
| Pours, thermals and islands | partial | Thermal relief gaps are 16-sided polygons, not round. |
| A negotiating autorouter | partial | Negotiation reroutes automatic legs whole and never shoves held or drawn copper; a tangle may still need a waypoint. |
| Arcs in routes and outlines | partial | Bezier curves and elliptical arcs reach the Gerbers as segments; only circular arcs stay arcs. |
| Length targets and match groups | partial | Meanders are single sided and added after routing; a route too long or with no room is reported, not rerouted. |
| Any-angle tracks | missing | planned |
| BGA escape patterns | missing | planned |
| Blind, buried and micro vias | missing | planned |
| Bus routing with fly-by and star topologies | missing | planned |
| Interactive routing in the viewer | missing | planned |
| Routing past a thousand nets | missing | planned |
| Via-in-pad and back drilling | missing | planned |

## Checks

| Feature | Support | Evidence |
| --- | --- | --- |
| DRC points at the line | supported | `packages/pcbjs/tests/drc-rules.test.mjs` |
| Board tests and golden fab sets | supported | `packages/cli/tests/board-tests.test.mjs` |
| Declared current-width checks | supported | `packages/pcbjs/tests/current.test.mjs` |
| Positions and lengths with inspect | supported | `packages/cli/tests/inspect-batch.test.mjs` |
| Rule values and overrides | supported | `packages/pcbjs/tests/overrides.test.mjs` |
| Rule values with their sources | supported | `packages/lib/tests/impedance.test.mjs` |
| The edit loop in one command | supported | `packages/pcbjs/tests/cli-output.test.mjs` |
| Visual diff against a commit | supported | `packages/cli/tests/diff.test.mjs` |
| ERC on the netlist | partial | Pins have no electrical roles yet, so ERC checks connectivity, not drivers against loads. |
| Crosstalk spacing checks | missing | planned |
| Electrical pin roles in ERC | missing | planned |
| Return path continuity across plane splits | missing | planned |
| Silk to pad and courtyard over edge checks | missing | planned |
| Stitching vias at layer changes | missing | planned |

## Output

| Feature | Support | Evidence |
| --- | --- | --- |
| Ready to order | supported | `packages/export/tests/export.test.mjs` |
| 3D with generated part models | supported | `packages/pcbjs/tests/step-model.test.mjs` |
| A project as an npm package | supported | `packages/pcbjs/tests/library.test.mjs` |
| Boards on your own site | supported | `packages/cli/tests/facets-plugin.test.mjs` |
| Fab presets | supported | `packages/fab/tests/fab.test.mjs` |
| Fetch and fit STEP models | supported | `packages/cli/tests/model-cmd.test.mjs` |
| One design, several fab targets | supported | `packages/pcbjs/tests/variants.test.mjs` |
| Assembly and fab drawings | missing | planned |
| Enclosure clearance against a STEP model | missing | planned |
| Flex stackups and bends | missing | planned |
| KiCad export | missing | planned |
| ODB++ and IPC-2581 | missing | planned |
| Panelization with rails, mouse bites and fiducials | missing | planned |
| Stencil files | missing | planned |

## Editor

| Feature | Support | Evidence |
| --- | --- | --- |
| A language server for any editor | supported | `packages/lsp/tests/server.test.mjs` |
| A live viewer in 2D, 3D and schematic | supported | `packages/viewer/tests/loading.test.mjs` |
| An open editor protocol | supported | `packages/cli/tests/ide-version.test.mjs` |
| Code and board select each other | supported | `packages/ui/tests/selection.test.mjs` |
| Defined viewer operations | supported | `packages/ui/tests/gesture.test.mjs` |
| One key map | supported | `packages/ui/tests/keys.test.mjs` |
| Project-bound editor actions | supported | `packages/vscode/tests/action-owner.test.mjs` |
| Source ranges on every item | supported | `packages/pcbjs/tests/source-ranges.test.mjs` |
| The VS Code extension | supported | `packages/vscode/tests/start.test.mjs` |
| Drag on the board, written to the source | partial | The tools work in 2D and 3D; no DRC preview runs during a drag. |
| Edit instance and library layouts | partial | packages/ui/tests/selection-store.test.mjs |
| Editable snippets in the browser | missing | planned |

## Agents

| Feature | Support | Evidence |
| --- | --- | --- |
| An MCP server for coding agents | supported | `packages/cli/tests/agent-surfaces.test.mjs` |
| A versioned JSON report | supported | `packages/pcbjs/tests/cli-output.test.mjs` |
| Agent skills | supported | `packages/skills/tests/skills.test.mjs` |
| Events, queries and scripts | supported | `packages/cli/tests/session-agent.test.mjs` |
| One reference grammar | supported | `packages/core/tests/ref.test.mjs` |
| Renders without a browser window | supported | `packages/cli/tests/render-fixtures.test.mjs` |

## Tooling

| Feature | Support | Evidence |
| --- | --- | --- |
| The compiler in a browser | supported | `packages/pcbjs/tests/browser-equality.test.mjs` |
| A cached compile stage graph | supported | `packages/pcbjs/tests/stage-cache.test.mjs` |
| A first board in nine steps | supported | `packages/cli/tests/docs-topics.test.mjs` |
| A project in one command | supported | `packages/cli/tests/create.test.mjs` |
| A support matrix with evidence | supported | `site/tests/features.test.mjs` |
| A workspace of projects | supported | `packages/cli/tests/workspace.test.mjs` |
| Docs in the terminal | supported | `packages/cli/tests/docs-topics.test.mjs` |
| KiCad conventions mapped | supported | `packages/kicad/tests/footprint.test.mjs` |
| KiCad import | supported | `packages/kicad/tests/import.test.mjs` |
| One CLI for every step | supported | `packages/cli/tests/doctor.test.mjs` |
| One session for editor and agents | supported | `packages/cli/tests/session.test.mjs` |
| Small packages, one build | supported | `packages/pcbjs/tests/exports.test.mjs` |
| Vendor libraries and part search | missing | planned |
