# Editor actions

VS Code operations have an explicit design owner, source effect and cancellation rule.
Advanced. Setup and commands: vscode.md. Viewer gestures: interaction.md. Source writes: editing.md.

## Ownership

The file or row that starts an operation determines its checkout, session, project and board. Focus changes during an asynchronous operation do not retarget it. A disconnected row or fabrication card refuses navigation and asks you to refresh. Source navigation opens the named source range; it never writes code.

Parts, findings, nets and BOM in the sidebar describe the first compile target. Selecting a row explicitly switches to that target before selecting its entity. A fabrication finding uses its card's project, session and target, including when another editor has since taken focus. Non-first targets remain read-only for source tools. Unknown target requests leave selection unchanged and report why.

## Open and close

Boards exposes boards from workspace-root configs directly at the top level. Other configs have a row labeled by their workspace-relative folder path without the config filename; failed or empty root configs retain a status row. Expanding a config resolves all declared entries and shows their boards directly, without source-file rows or preview navigation; Git projects omit untracked entries. A board click opens its exact entry and selects it in all panes, preserving the current iframe when the project is unchanged and doing no reload for the already shown board.

Open 2D, Open 3D, Open schematic and Open DRC/ERC reveal an existing pane or open one. Their Beside forms reuse that view or open it beside the editor. Open another always creates a numbered pane. Toggle preview closes the first pane of the last-used view when it is already open. Closing a preview or detaching leaves the shared session available to other clients.

Reload preview reloads the pane. Restart server restarts the shared session. Restart server and clear caches additionally removes generated caches for its served projects; it does not change design source. The progress and output identify that scope.

The status bar normally opens the view picker. Failed opens the session log, older session offers restart, and Not installed opens installation. The tooltip identifies the current action. A source-file focus can change the active project's status and preview when Follow Focus is enabled.

## Source undo

Cmd or Ctrl+Z from a preview invokes native chronological undo; Shift adds redo. There is no preview undo button. The preview remembers the last source document edited for its board across sibling panes and reloads, falling back to the board entry before any preview edit. Later edits to that document, whether from code or another pane, are undone first. The status message names the document, and focus returns to the pane. This uses the same history as undo in that source editor, without requiring page-local undo steps.

A request naming multiple distinct source documents is refused before changing any document. Use Undo or Redo in the individual source editors. The pane does not selectively reverse its old transaction across later changes. Standalone pages use the session's per-client edit history and refuse an undo after an intervening file change.

## Value editing

A dotted underline marks a supported value. Edit value opens native choices or a validated text input. Enter or choosing a value applies one source edit; Escape closes the choice or input without changing source. A single non-typed action, such as changing side, applies immediately. Invalid text stays in the input with a reason. These controls do not preview changes on every keystroke.

`pcbjs.editorAutoSave` defaults to true and saves the document after an accepted value edit. Turn it off to keep the edit in the unsaved buffer. Placement gestures use the session's versioned editor write path and remain unsaved. Native source undo remains available for accepted edits.

## Availability and verification

An operation without an applicable project, editable literal, current session or target must explain the missing precondition. Preview-only navigation has no source undo; Escape cancels an active gesture before it writes. Build and installation produce filesystem results and do not promise source-editor undo.

The repository's `scripts/vscode-contracts.json` maps operation families to contributions, source and test evidence. Its completeness test detects unregistered commands and contribution changes. That is an inventory check, not proof of runtime behavior. Real VS Code acceptance additionally checks pane focus and layout, keyboard commands through the iframe, native undo and picker cancellation; socket tests check session ownership and stale operations; viewer browser tests check geometry and feedback.

## DRC/ERC viewer

DRC/ERC is the fourth persistent preview, shared with the browser at `?view=checks`. Its first opening never replaces the active preview: it prefers a group showing the board source, then a non-preview group, then an inactive preview group, else creates a split. Background source tabs do not count as currently shown.

The expanded list and previous/next buttons navigate the current target's DRC and ERC findings through canonical selection. Changing findings keeps the same pane and frame. Source focus and clearing the finding leave the viewer open; closing its final VS Code pane clears shared finding focus. The other three views display error types without full diagnostic messages.

Full structured HTML details include measurements, location, entities, provenance and geometry. Click references, use Ctrl/Command to toggle several, or select text across references to synchronize entity highlighting. The icon-only Copy as Markdown button copies a structured snapshot with accessible success/failure feedback. It replaces the temporary document's Save As workflow.

## Development inspector

In the pcbjs source workspace, an Extension Development Host, or with `pcbjs.development` enabled, the command palette provides Toggle, Enable and Disable preview dev tools. The inspector action in the preview editor title addresses only the active preview. The live preview also has an inspector icon. Built static pages do not expose the overlay.

The inspector shows the visible UI hierarchy, component/source labels, control properties, parent/child relationships and current preview state. Pick highlights a control without editing the board. Copy UI report puts a JSON snapshot on the clipboard for a bug report. Close disables the overlay in that pane; sibling panes keep their own setting.
