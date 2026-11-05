# Interaction contract

The operation families, visible results and source boundaries of the board UI.
Advanced. viewer.md, editing.md, keys.md, 3d.md and editor.md describe the controls; this topic defines their common contract.

## State and source

Hover changes only transient highlighting. Selection and source navigation change view/session state, never design source. A click identifies one target, one chip and one source destination; only copper anchors add net context. Multi-selection retains an anchor that determines available tools. Move and rotate affect eligible selected placements; side affects only members with a side capability. Automatic placements are excluded. Library layout tools use shared definition geometry beneath instance overrides. Point tools affect the anchor route only. Toolbar tooltips name those targets. A single group rotates about its own grid origin when attached, transformed by its placement; other single placements use their own origin. Multiple placements rotate about the midpoint of their origins. Frames keep the actual pivot and compass in view. Camera side and mirror change presentation; the Side tool changes the design.

An eligible edit previews locally, commits once through the version-checked session edit service, then waits for the compiled result. Escape cancels the current drag before leaving assist, cancelling finding focus, ascending isolation or clearing selection. Cancel writes nothing. With an editor attached, undo/redo uses chronological native history of the single source document last edited for that board, falling back to its entry, including later edits from other panes or code. A request naming multiple distinct source documents is refused before undo; use the source editor for those files. A standalone page uses conflict-checked per-client session history. This is not selective transaction undo in the editor. Failure and stale-version refusal show a reason. Preview motion alone is not a successful write.

Editing requires a writable session and an eligible, unlocked source node. `locked` placements remain selectable and traceable to source, but take no geometry tools or assist writes. Their toolbar lock button remains available to remove a bare `locked`; expression-driven states disable the toggle with an explanatory tooltip. Groups containing locked parts and mixed selections cannot bypass the lock. The server rechecks it during update and commit; a new lock cancels an active viewer drag. Built sites and embeds have no editing tools. Non-default target previews are read-only. A library layout edit changes the shared definition while retaining instance overrides. Its local frame and effective parameters come from the selected group. Ordinary placement edits target their instantiation; repeated loop/helper literals can refuse edits. Hidden layers, stale entities and unsupported node types do not gain editing authority from selection. Panel selection keeps hidden layers hidden. Framing uses the target geometry bounds; the chip can identify a selection whose layer remains invisible.

## Navigation inputs

| Context | Input | Result |
| --- | --- | --- |
| 2D/schematic | wheel | zoom about the cursor; keyboard +/- zoom about the view center |
| 2D/schematic | left drag over 3 px after assist/edit declines | pan; a stationary press selects |
| 3D | left drag on background | orbit; an eligible active edit takes priority |
| 3D | middle drag or wheel; right drag | camera dolly; pan, using OrbitControls defaults |
| 2D/schematic/3D | two-finger pinch and drag | zoom and pan about the finger midpoint, including gestures begun on preview controls or diagnostic labels; never zoom the page |
| all views | F; view buttons or V | fit board/sheet; change view |
| movement/control points | Shift drag; Cmd/Ctrl drag | free of snapping; dominant-axis constraint |
| rotation ring | drag; Shift; Cmd/Ctrl | 15 degree stops; 5 degree stops; free angle |

A second finger cancels an active one-finger edit or selection gesture before navigating. After pinching, remaining fingers cannot select, edit or activate controls until lifted. A new single tap works normally. Native page gestures outside the preview and single-finger scrolling in its menus remain available.

Hover clears at the viewport boundary, including during a captured drag. A captured drag can continue outside the viewport until its initiating button is released. Pointer cancellation, lost capture, window blur, a hidden document or a move with the initiating button no longer held cancels the gesture without a source write or click. A release missed by the canvas also clears its gesture state. Other pointers cannot take over the active gesture; two-finger navigation follows the cancellation rule above.

These are pcbjs bindings, not universal CAD shortcuts. The schematic selects and cross-probes but has no editing tools. Coordinate readouts inspect positions; there is no two-point distance/angle measurement tool or general canvas drawing tool. Route assist writes an already open source slot; route handles edit eligible chains. It is not an unrestricted canvas router.

## Operation index

`V` changes view/session state without source writes. `W` commits one source transaction with cancel and undo as above. `U` is unsupported; `M` sends an external message only on explicit submission. IDs join the source/test inventory in `scripts/ui-contracts.json`. Source references and existing tests are traceability, not a claim that every operation passed browser or installed VS Code acceptance. The inventory records remaining acceptance explicitly.

| ID / operation | Trigger/context | Visible result and boundary |
| --- | --- | --- |
| NAV01 select view | 2D/3D/Schematic/DRC-ERC buttons, V cycle | one active canvas, matching pressed button, ready signal cleared then restored; V |
| NAV02 fit | F or fit control, mounted view | board/sheet framed, 3D exploded extent included; V |
| NAV03 zoom | wheel, +/=/- | zoom around defined cursor/center, readout and grid adapt; V |
| NAV04 pan/orbit | background drag in 2D/sch; 3D camera gestures | camera changes; no accidental selection/edit; V |
| NAV05 grid | G/button | grid visibility changes in mounted views; V |
| NAV06 ratsnest | N/button | connection indicators and ratsnest toggle; V |
| NAV07 side/mirror | front/back view and mirror controls | side stacking or camera bottom; 2D mirror; V |
| NAV08 layers | rail click hide, double-click solo; Front/Back/All/Copper presets | visibility plus outline, active preset; V |
| NAV09 schematic layers/split | category rail, Board split | symbols/wires/labels/power/sheets/text/findings hide/solo; board beside sheet; V |
| NAV10 3D appearance | fade toggle, opacity, mono, shaded/edges, grouped/stacked | only intended focus/background presentation changes; V |
| NAV11 explode | toggle and separation slider | layer separation, bodies aligned, fitting correct; V |
| NAV12 theme/reload | theme control; pane reload | theme immediate, reload recovers current pane; V |
| SEL01 hover | all entities and same modifiers as click | exact prospective selection lights, readout clears on leave, no editor movement; V |
| SEL02 part/pad | ordinary body/pad click; Mod pad deep select | part or pad, one chip and source reveal; copper-only context; V |
| SEL03 instance | click member, click already selected instance, double-click | whole instance including routes/silk; enter definition with clicked member; V |
| SEL04 route/leg/point | track/via ordinary click, Mod automatic leg, double-click route | route or leaf/nearest point, correct chain reveal and context; V |
| SEL05 plane/text/graphic | click or hover | item geometry only, no unrelated net context; V |
| SEL06 net/finding | ratsnest/wire/label, finding dot/line or panel row | net context; finding tab focused and witness framed; dot wins hover; V |
| SEL07 modifiers | Shift toggle, Mod deep, Alt definition | ordered members/anchor; no ancestor+descendant; Alt keeps selection and reveals definition; V |
| SEL08 clear/ascend | empty click, Escape, path segment/remove chip | empty clears members and instance context; library context persists; finding cancellation restores the prior camera; Escape cancels finding before ascending/leaving isolation; V |
| SEL09 isolation | I, path toolbar layout buttons below badges | first group click offers both modes; second click enters instance layout; library mode shows only shared local definition geometry; V |
| SEL10 multi-selection tools | Shift multiple then M/R/L | toolbar names eligible placed members for move/rotate/side and anchor route for points; W |
| EDIT01 placement | drag or frame X/Y fields with units | compass and source-frame coordinates agree; one transaction; W |
| EDIT02 move modifiers | Shift drag free, Mod drag dominant axis | preview and written coordinates agree; no explicit grid snaps to integer mm; W |
| EDIT03 rotate | R, compass ring or degree field | shared grid pivot or placement origin; source-frame angle; W |
| EDIT04 flip | L or Side selector | B side attribute, F removes it; distinguish camera-side controls; W |
| EDIT05 trace | primitive/case/layer, previous/next, focused interior click | exact source call; insert splits segment; endpoints preserved; W |
| EDIT06 delete | Delete icon or Delete/Backspace | remove call, compensate later relative/axis endpoint across modifiers; W |
| EDIT07 undo/redo | Mod Z / Mod Shift Z | editor: chronological history of the named source document; standalone: per-client undo; W |
| ROUTE01 assist | open H/V/L/X/empty at source slot; hover/click dot/end | typed preview, clearance, eligible endpoint, one argument/handle write, cursor advance; W |
| ROUTE02 assist Shift | Shift exposes all dots | expected l vs X choice shown, no accidental ordinary selection; W |
| DRAW01 general draw/route-start | no general draw or free-standing toolbar router found | no implied promise of arbitrary canvas drawing; source-driven assist only; U |
| MEASURE01 measurement | no distance/angle measurement command/control found | coordinate/readout is inspection, no two-point measurement tool; U |
| PANEL01 board/rules/stackup | tabs/rail | correct current board counts/rules/layers/material thickness; V |
| PANEL02 BOM/net/part/circuit | rows/filter, pin/pad net native buttons | corresponding selection and details, keyboard equals pointer; V |
| PANEL03 DRC/ERC | list toggle, row, previous/next, entity selection, Copy as Markdown | shared finding focus without remount; full details only here; clipboard-only copy; disabled boundaries; V |
| PANEL04 source links | click/Alt or placement/definition chip buttons | reveal correct view-origin range without stealing preview focus; V |
| PANEL05 chip context menu | right-click chip, Send to agent, choose/comment/Send/Cancel | explicit selected refs sent to chosen attached agent only on Send; M |
| MODAL01 palette/help | / or ?, search/arrows/Enter, Tab cycle, Escape | modal owns focus; explicit command runs; focus restored; V |
| STATE01 load/stale/error | first meta, invalidation, facet updates, disconnect, resync/reload | loading vs stale board distinguishable; stale entities unpickable; error/reason accessible; V |
| STATE02 responsive drawers | Layers/Details, scrim, narrow viewport | one usable rail/drawer, no canvas hit-through; V |
| SITE01 board/variant/home/download | picker/card/link | selected scope/board/target in URL and model; SVG/zip intended board; V |
| DEV01 UI inspector | development command or inspector button, pick/filter/copy | pane-local hierarchy, properties and highlight; no selection/source mutation; V |
| SITE02 URL/embed | view/selection/isolation/layer/side/mirror params; parent messages | initialize once and frame explicitly; ready after paint; V |

Every action must keep board, project and target identity through delayed work. Host actions may name a board and target: an explicit null target chooses the first compiled target before selection, a named target must exist, and omission keeps the current or remembered target. An unavailable identity refuses the action. Read-only, missing source, missing editor and stale compile states need explicit feedback. Dialogs own focus and board shortcuts until dismissal, then restore focus. Source reveal preserves preview focus. Unsupported actions must not silently mutate source. Registry coverage cannot establish these outcomes: acceptance must inspect the actual source diff, cancellation/undo result, compiled geometry and visible feedback on the exact candidate.

Schematic panes load ERC findings alongside the sheet and fit finding focus only when that finding has a visible schematic marker. PCB-only findings keep the sheet camera unchanged. Full diagnostic messages and evidence remain in Checks; Copy as Markdown preserves the same optional evidence fields. Standalone undo follows session history, while editor previews forward keyboard undo to native document history.

Selection identity includes the board, target and snapshot, so changing a variant or refreshing a snapshot propagates even when its references stay the same. A reference selection made by the editor or an agent clears old finding focus unless it explicitly supplies a finding. An explicit finding with an affected entity keeps checks open and reveals that entity's source; selecting the finding itself opens checks without jumping to an arbitrary witness. Clearing selection and selecting an unrelated entity clear finding focus. A complete canonical selection can explicitly focus a finding with no entity references. Session replay preserves the canonical selection and does not send it back as a new action.
