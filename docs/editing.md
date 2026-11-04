# Editing

2D/3D tools move, turn and flip parts, groups, instances and text, edit route points and pick chain arguments, writing once at the source.
Advanced. Selection: viewer.md. Snapping: grids.md. Patches: patches.md. Shortcuts: keys.md.

```sh
npm run dev   # select a part in the 2D or 3D view: the toolbar shows Placement coordinates, rotation and side
```

Source tools and cursor assist edit only the first variant target; others explain their read-only state. Target switches clear overlays. Transaction IDs expire on project reload or detach; expired updates, commits and cancels are refused.

## The toolbar

The focus toolbar identifies Trace or Placement. Placement fields edit X, Y and rotation in the placement’s enclosing source frame, accepting lengths such as `10mm` or `100mil`; side selects Front or Back. Rotation accepts degrees or radians. Invalid values are marked without writing source; Escape restores the current source value. Refused edits restore the fields, and pending edits temporarily disable them. The compass continues to handle dragging and rotation without a toolbar mode switch.

Trace controls select a geometric primitive, its relative form and its copper layer. The API uses uppercase `H`, `V`, `L`, `A` for absolute endpoints and lowercase `h`, `v`, `l`, `a` for relative offsets. Relative is checked for lowercase commands. Changing case rewrites coordinates to preserve the endpoint. Choosing a different primitive changes its geometry; a newly chosen arc uses a 90 degree sweep. `X` autoroutes and `Z` finishes straight to the route destination. The layer selector edits the nearest preceding via transition, or the route’s initial `.layer()` property when there is no transition; `.layer()` is route configuration, not an inline transition.

A click on a literal trace segment selects its generating primitive in the source, including the leading dot. Previous and Next skip non-geometric calls; Delete removes the selected primitive and compensates the next relative command to keep its endpoint fixed, promoting a relative axis to `l` when needed. Click the interior of the focused manual segment to insert a snapped point. The grid menu includes standard pitches and subdivisions of a custom pitch. Placement grid choices write the component's `grid` attribute without moving geometry. Snap is recomputed from alignment with the selected grid and its allowed subdivisions; `maxLevel` bounds subdivisions, with two levels by default. See grids.md. Reset view restores the view’s fitted frame. Source destination and write details stay in tooltips.

Available operations, by anchor capabilities:

| Capability | Who has it | Tools |
| --- | --- | --- |
| `placed` | a part, a named `<g>`, an instance, a text | coordinate fields and compass rotation |
| `layered` | a part, a named `<g>`, an instance | the side, F or B |
| `chain` | a route | primitive, relative form and layer |
| `viaEnd` | a route with a chain via | the via's layer with its point |

Board `edit` holds capabilities, frame, coordinate grid, optional persisted `snap` pitch and subdivision limit, and sources. `def` names the literal's definition, schematic.md; `frames` lists enclosing instances/groups, outermost first, own frame last.

## Gestures

Each gesture writes and compiles once. The chip shows `Written quad.pcb.tsx in the editor` or the refusal reason.

| Gesture | Writes | Where |
| --- | --- | --- |
| drag the anchor part, group, instance or text | its `at`, snapped to its grid's dots; shift free, cmd or ctrl along one axis | the element that placed it; a shared literal gets its own `at`, in library layout mode the shared definition |
| ring drag, 15 degree stops, 5 with shift; or `R`, 90 | its rotation | the same element |
| the side select or `L` | `side="B"`, deleted back on F | the same element |
| drag a route point | the call's argument | the chain call |
| click a dot while the editor waits for an argument | the argument, `.H(7)` | the slot |
| Delete on a picked point | removes the call | the chain |
| cmd or ctrl+Z, shift for redo | source history in VS Code; page history elsewhere | editor-actions.md |

- Preview moves immediately; Escape cancels. On release, the part stays half-opaque at its destination until the matching compile lands.
- Grid dots pass through the anchor origin, showing move destinations, grids.md; absent a grid, moves snap to whole millimetres. Shift moves freely. Both 2D and 3D use neutral-gray dots at up to 36% opacity beneath the focused geometry.
- A named group with an attached grid turns about that grid's resolved origin, including the group's rotation, side and translation. Other single placements turn about their origin; multiple placements turn about their placement midpoint. The preview and source write share this centre.
- The compass marks every 5 degrees when there is room and every 15 degrees when compact, with longer 15 and 90 degree marks, a pivot cross and a heading readout. Dragging crosses the angle seam continuously; Command or Control rotates freely.

## Control points

For a route anchor, `P` or Points shows chain-end dots, `route:3/pt:k`, and dashed automatic-leg midpoint handles.

- Drag a dot to move its call's end: `.V(14)` becomes `.V(16)`, `.H('2mm')` keeps its unit; a relative call after it is rewritten so the later points stay put.
- A click picks a dot; Delete removes its call.
- A click on the route's copper puts a point there, `.L('x y')`.
- Drag a leg handle to route the leg through the drop point: `.X('x y')` before the call ending the leg, or at the chain's end for the final leg.

## Assist

A cursor in `.H(|)`, unclosed `.l(|`, short `.L(5, |)` or empty `at="|"` offers argument dots in 2D and 3D.

```text
{route(J1[1], R1[1]).H(|)}   the cursor at |
```

- The language server sends the context: command, start, layer, net, side and grid.
- The start pad has a centre cursor. Dots: row for `H`/`h`, column for `V`/`v`, four directions for `L`/`l`, matrix for `X`/`at`. Absolute dots use grid columns, relative dots pitch steps; absent a grid, whole millimetres. Shift shows all grid dots.
- Dots stay inside the outline or within 12 pitches of the start. A dot on another net's copper or in a keepout is faint, its reason on the chip.
- Hover or type to preview the trace and concise finding rule names, such as `clearance`, or `DRC clean`. Full explanations belong in the DRC/ERC viewer. `X` routes around copper. Shift picks `l` for a clean straight trace, else `X`, shown before clicking.
- Click writes `.H(20)` through the editor, closes an unfinished call and advances the cursor. Escape leaves assist until the cursor moves.

Assist uses `session/edit/begin { tool: 'assist' }`. `update { point, pick? }` returns a plan with `preview { command, tracks, vias, findings, error?, ms }`; commit returns `cursor`. Context: `pcbjs:assist`, ide-bridge.md.

## Route ends

In `route(|)` or `route(J1[2], |)`, 2D and 3D annotate open netlist ends.

- After end `A`, candidates are its net's terminals not yet joined by copper. In the first slot, every terminal with an open ratsnest line. Omit ends already written.
- Terminals are pads and the points `.start`, `.pt(k)` and `.end` of bound routes, an instance's included: `ch2.vccTrunk.pt(2)`. An end the router cannot reach for a layer reason is still listed.
- Each candidate is ringed and labelled with its pin number, its pin name when it differs, and its net, `1 B · SIG`; the rest fades. The chip reads `4 open ends on VCC`.
- Hover shows the handle in cursor scope, `J1[2]` or `ch2.vccTrunk.end`. Out-of-scope ends are omitted: `CH3 is not in scope here`. Click writes through the editor and advances the cursor: the first end adds `, `; later picks append, `route(J1[2], R1[1], R2[1])`. Escape leaves until the cursor moves.
- The language server completes the slot with the same set and labels, editor.md.

The context carries `ends { slot, append, net, candidates, notes? }`, each candidate `{ handle, label, kind, ref, num?, name?, net, at, side }`. A pick is `session/edit/update { end: 'J1[2]' }` in an assist transaction; a handle the slot does not offer is refused.

## In 3D

3D uses the same gestures and `session/edit/*` calls, with its toolbar at the pane's foot.

- A press on the selection starts a move; on a ring handle, a turn; on a route's dot or leg handle, a point drag. A press elsewhere orbits.
- A part or an instance moves on its side's copper plane, its bodies with the pointer, its pads, routes and texts drawn where they go.
- The ring and the dots lie in that plane, control points on the route's layer; snaps are as in 2D.

## What a drag writes

A placement edit changes its instantiation source, using its group's frame and preserving grid units or explicit units. Instance layout edits create own placements; library layout edits change the shared element while keeping instance overrides. Route control points update chain calls, and compiler-generated copper can require patches. Automatic placements and shared loop/helper literals can refuse writes. See [Source ownership](layout-editing.md#source-ownership) for the complete edit-to-source table and examples.

## Inside an isolation

The first group click offers **Instance layout** and **Library layout** below the badges; the second enters instance layout directly. Library mode shows a local reusable definition with effective parameters and without own placement overrides. Its tools and source navigation target the shared layout while preserving instance overrides. Library mode also isolates the schematic template; the checks viewer keeps the complete board. See [Layout editing](layout-editing.md) for navigation, loading, source ownership and undo.

## Where it goes

A drag previews every frame and commits once on release.

- With an editor, the session writes through its `workspace/applyEdit`, one undo step per file, unsaved; with none, to disk.
- Refuse commits after the literal or editor buffer changes, and begins against boards unseen by the view.

The tools are hidden on a built site and in an embed; in a read-only session or a viewer beyond loopback the chip says `read-only`; an anchor without tools, `no placement` or `select a part`.

## Undo

Cmd or ctrl+Z undoes; Shift adds redo. Undo and redo use keyboard shortcuts; there is no preview toolbar button. The status message identifies the source document, editor-actions.md. One preview gesture may change only one source document; a plan spanning multiple files is refused before writing any of them. Select items from one source file and edit them together.

- VS Code uses chronological history in the pane's named source document, including later code or other-pane edits. Multi-file requests change nothing; use the source editors.
- Elsewhere the session writes back the text each commit replaced, through the editor holding the file, else on disk, and removes a patches file the edit created.
- Standalone undo refuses intervening file changes.

## The protocol

Read-write session methods:

```ts
type Written = { file: string; via: 'editor' | 'disk'; applied: boolean; reason?: string }[]
interface EditMethods {
  'session/edit/begin'(p: { board: string; target?: string; run?: number; tool: 'move' | 'rotate' | 'layer' | 'point' | 'assist'; refs: string[]; anchor: string; isolate?: string }): { txn: string; tools: { id: string; needs: string; key: string }[] }
  'session/edit/update'(p: { txn: string; delta?: [number, number]; angle?: number; side?: 'F' | 'B'; grid?: number; command?: 'H' | 'h' | 'V' | 'v' | 'L' | 'l' | 'A' | 'a' | 'X' | 'Z'; layer?: string; point?: { at: [number, number] }; remove?: boolean; insert?: boolean; free?: boolean; pick?: boolean; end?: string }): { txn: string; files: { file: string; edits: object[] }[]; notes: string[]; findings: string[]; preview: object | null }
  'session/edit/commit'(p: { txn: string }): { txn?: string | null; written: Written; error?: string; cursor?: { file: string; line: number; col: number } }
  'session/edit/cancel'(p: { txn: string }): null
  // the caller's latest commit or the named one; session/edit/redo alike
  'session/edit/undo'(p: { txn?: string }): { txn?: string | null; written: Written; error?: string }
}
```

Positions use board mm; angles are counter-clockwise degrees; anchors: `route:3/pt:k` or `route:3/leg:k`. VS Code panes post `pcbjs:undo { files, redo, board, project? }` for native source history, and `pcbjs:edit-written { files, board, project? }` after successful editor writes so sibling and reloaded panes retain the source owner. Viewer mode comes from ready; the session sends `pcbjs:editor { attached }` on editor changes and `pcbjs:grid { board, grid }`.

## Limits

- The schematic selects but does not edit. The `at` dots write a position; the placer's fast mode for `at` is not built.
- A drag of a group without its own `at` writes one onto its `<g>`.
