# VS Code extension

Session connections, previews, commands and drafts; editor-actions.md defines actions.
Advanced. Installation: editor.md. Protocol: ide-bridge.md.

## Attaching

On preview or attach, the extension reads each workspace folder and project's `.pcbjs/dev.json` and connects to its live session by socket, Windows named pipe, else `/__pcbjs/session` WebSocket. It starts or attaches only projects in its checkout, excluding `.claude`, Git-ignored folders and other worktrees. Unserved folders get one detached session:

```sh
<dir>/node_modules/.bin/pcbjs session serve --workspace <folder>... --port 0 --host 127.0.0.1
```

- A `pcbjs dev` in a terminal is a session it connects to; Ctrl-C leaves it to the window.
- A project is a directory with a `pcb.config.*`, loaded when a pane shows it or you focus a file in it.
- Previews and sidebar actions use the focused design file's or selected row's session, resolving pages against its URL even with duplicate board names and routes. Another session's notifications cannot move the preview or source selection.
- It runs the project's own pcbjs, `node_modules/.bin/pcbjs` of the project, a parent or a workspace folder; a script link runs under `pcbjs.nodePath`. Else it runs a global `pcbjs` and says so once.
- The language client shares the connection; the session logs to `.pcbjs/log/session.log`. With several sessions attached, the one with the deepest root holding a file syncs and answers it and fills the trees; a file whose session ends moves to one covering it.
- A lost connection retries with a growing delay, starting a session when none is live, giving up after five losses; `Restart server` starts a new session, each pane keeping its view and board. Detach or closing the window leaves the session to others for ten minutes. Reload and reopen attach fresh window connections to that session and restore saved preview tabs. Teardown cancels pending connection attempts and retries immediately, settles scope/readiness waits, and bounds language-service cleanup even if it fails. If the OS kills the editor process, transport closure releases its clients without relying on deactivation.
- The status bar shows the `@pcbjs/pcbjs` of the active editor's folder: `pcbjs <version>: 2 boards`, `attaching`, `reconnecting`, `restarting`, `failed`, a failed-state click opening the log, or `older session`, a click restarting it. It warns when the packages disagree on major.minor; `pcbjs: Not installed` runs the install flow. `Fabrication` beside it opens the dialog of editor.md.

Panes use the VS Code theme, a floating toolbar and layers drawer. The server works out the project and board of the focused file through its module graph:

| Focused file | Shows |
| --- | --- |
| in the graph of one board | that board |
| shared by several | the shown board when it is one, else the first in entry order |
| imported by no board | a preview `preview:<file>` of its default export: a `<PCB>`, a part at the origin, a circuit through its layout or parts in a row, a layout with a net per port; never built |
| in another project | switches project, then the rules above |
| nothing to preview, or in no project | no change |

While editing a pad accessor such as `R1[]`, typing or moving the caret inside the brackets opens a footprint hint with pad numbers. Entering a pad number or pin name outlines that pad; leaving the brackets dismisses the hint. It does not move the caret or change the design.

A server that fails to start leaves its last 40 lines and Restart in the pane. A click in a pane puts the cursor on its placement in the code, focus staying. Source navigation prefers an existing tab, including a background tab behind another preview. Only the editor group containing the preview being clicked is excluded; other preview groups remain eligible for tab reuse. A new source tab is opened only when no eligible existing tab is found, preferring an ordinary source group, then an inactive preview group, then a new split; cmd or ctrl+Z uses chronological source-document undo, editor-actions.md.

Source files opened by extension navigation use VS Code preview tabs. Opening another source replaces the previous clean temporary tab in that group. Editing or pinning a tab keeps it open; existing pinned tabs stay pinned, including when moved out of the active preview group. This follows the native preview-editor setting and does not close files merely because keyboard focus moves elsewhere.

Restored preview tabs reconnect after a window reload, including tabs restored later than the first session attachment. A scope or project update during URL resolution restarts the pending viewer load; the panel is marked loaded only after its iframe HTML is installed. Newer connection states supersede older pending loads.

## Sidebar

The pcbjs activity icon opens five views:

- Boards: nested configs use folder rows labeled by their workspace-relative path without the config filename. Configs at workspace-folder roots resolve automatically and show their registered boards directly at the top level. Nested configs remain folder rows; failed or empty root configs retain a row with their status. Expanding it resolves all declared entries and lists their boards directly, without source-file folders; expansion never switches a preview or opens source. In Git projects, untracked entries are excluded. Clicking a board shows it in every pane and opens its entry on `<PCB`; choosing the same board preserves its loaded views. The shown board lists parts, an instance's as `CH2/R01`; inline buttons open 2D, 3D or schematic.
- Sidebar parts, findings, nets and BOM describe the first target; choosing one switches the preview to it.
- Findings: under Errors, Warnings and Info, each under its exact id with its refs below. A click pans the panes to it and opens its code, a ref selects. A finding stays selected through a recompile that changes its id, findings.md.
- Nets: with their pad counts; a click pins the net in every pane, again unpins it.
- BOM: a row per line; a click opens the placement of its first part.
- Agents: each agent of the session, of a worktree only while it is attached, its task, progress line and plan, the findings delta since its first edit and its last files changed; one that left stays, marked. Stop and tell, inline, sends it a note with the selection as Send to agent does. Agent updates appear here without popups; the agent uses its main chat for user-facing communication.

With more than one git worktree, Boards ends with a Worktrees node, collapsed by default and remembering explicit expansion during the session. Each worktree shows its agent, task, boards and files changed against main, a file opening its diff. Inline, Open diff shows all changes, Open board attaches it to the window's session and shows its board in every pane under a banner of the agent and task, Detach drops it, and Merge runs `git merge` of its branch in the main tree. The extension's sidebar heading is PCBJS.

Trees read `session/facets` when `session/state` changes a held hash. Without a project, Boards offers setup commands.

## Send to agent

`Send to agent…` is in the editor's context menu, on a part in Boards, on a finding, in the palette and on the viewer's chip, greyed until an agent is attached, the context key `pcbjs.agents`. It sends the selection as one message, mcp.md: the selected rows or viewer members, else each editor selection with what the language server resolves in it. One agent gets it at once; several open a pick of name, task and age, the last choice first. The status bar says Sent to, then Read by once its next tool result carried it; one left unread comes back as a Returned notice.

## Get started

The "Get started with pcbjs" walkthrough opens once in a workspace without a project, or through `pcbjs: Get started`. Steps: install `@pcbjs/pcbjs`, create or open a project, start from an example, open the preview, check and read a finding, edit a value, convert from KiCad, install skills.

Install shows the exact `@pcbjs/pcbjs` version: `latest`, or the newest of `latest`, `beta` and `next` with the dist-tags checkbox, enabled in pre-release builds; offline, the packaged version. It runs `npm install -D @pcbjs/pcbjs@<tag>` in the active file's project.

Wizard defaults: folder `board`, else `board-2` or `.` when empty; 2 of 2, 4 or 6 layers; `JLCPCB/<layers>-Layer`; 50 x 40 mm rectangle with 2 mm corners, square corners or a 40 mm circle.

The create, example, wizard, convert, skills and check commands run the nearest pcbjs, else a global one, else `npx --package @pcbjs/pcbjs pcbjs`, output in the pcbjs channel, and `npm install` in a new project that has none. Without an installed pcbjs, Create project and the wizard ask its version first. They write `.vscode/extensions.json` recommending `pcbjs.vscode-pcbjs` into the project and into the workspace folder, with `customizations.vscode.extensions` of a devcontainer there, so a clone or Codespace prompts for it; a file with comments stays.

## Commands

| Command | Does |
| --- | --- |
| `Open 2D beside`, `Open 3D beside`, `Open schematic beside`, `Open DRC/ERC beside` | ctrl+alt+2, ctrl+alt+3, ctrl+alt+s, ctrl+alt+4; cmd+alt on macOS: open right or reveal |
| `Open another 2D view beside`, and 3D, schematic and DRC/ERC | Alt held or Shift added to the keys: new pane, `Blinky \| 3D (2)` |
| `Open all views` | `pcbjs.openAllViews`: 2D, 3D, schematic and DRC/ERC |
| `Open a view of the board` | also the status bar item: a pick of four views or all views |
| `Open 2D view`, `Open 3D view`, `Open schematic view`, `Open DRC/ERC view`, `Toggle preview in the last used view` | open/reveal; only Toggle closes |
| `Reload preview` | reload a pane or every pane, attaching again when the session is gone |
| `Attach to the session`, `Detach from the session`, `Attach to the session again`, `Restart server` | the window's sessions |
| `Purge Reload Dev Suite (dev)` | development mode and exactly one pcbjs source checkout: save edits, disconnect this window, stop checkout PCB sessions, clean-build core/UI, clear project/model caches, package and force-reinstall the local extension, then reload the window; stops at the first failure, leaves the docs server running |
| `Restart server and clear caches` | cmd or ctrl+shift+R in an active pane: ends the session, runs `pcbjs cache clear --models` over its folders, starts it, reloads the panes |
| `Open the session log`, `Open in browser`, `Show output`, `Toggle cursor sync` | as named |
| `Send to agent…` | the selection to an agent, see Send to agent |
| `Stop and tell`, `Open diff`, `Open board`, `Detach`, `Merge` | on an agent and on a worktree, see Sidebar |
| `Edit value` | the value editor under the cursor, editor.md |
| `Create project in workspace`, `New board wizard`, `New project from an example` | `pcbjs create` with the wizard's flags or `--example`, then `pcb.tsx` and its preview |
| `Convert from KiCad` | `pcbjs import board` of a `.kicad_pro` with its `.kicad_pcb` into `<name>-pcbjs` |
| `Install skills` | `pcbjs skills install` in the project, else offers `npx @pcbjs/skills install` |
| `Run check` | `pcbjs check` in a project, its summary as a notice |
| `Fabrication` | the dialog of the fab sets, editor.md |
| `Install pcbjs in the project` | the install flow of Get started |
| `Use the pcbjs file icons in Material Icon Theme or vscode-icons`, `Remove pcbjs file icons` | see File icons |
| `Get started` | the walkthrough |

A focused pane takes the keys of keys.md; other chords reach VS Code.

## Settings

| Setting | Default | Does |
| --- | --- | --- |
| `pcbjs.autoStart` | false | attach when the workspace opens, else with the first preview |
| `pcbjs.cursorSync` | true | send the cursor to the session |
| `pcbjs.followFocus` | true | send the active file for the panes to follow |
| `pcbjs.nodePath` | empty | the node that runs pcbjs, 22.12 or newer; empty is `node` from PATH, `/opt/homebrew/bin` or `/usr/local/bin` |
| `pcbjs.editorAutoSave` | true | save after each inline edit, so the board recompiles |

## File icons

- Material Icon Theme or vscode-icons active: it adds their associations for `pcb.tsx`, `*.pcb.tsx`, `*.sch.ts`, `*.sch.tsx`, `pcb.config.*` and `.pcbjs/fab` to the user settings where a key is missing or older, with Undo for 20 s.
- Any other theme: one notice offers the "pcbjs" file icon theme, Seti with the pcbjs icons, plus each project's entries, footprint modules and fab zips by name.
- `Use the pcbjs file icons …` writes the associations by hand, every entry and footprint module listed; `Remove pcbjs file icons` undoes every change.
- The Seti part, `assets/icon-theme/seti.json` and `seti.woff`, comes from microsoft/vscode under the MIT licence, kept in `assets/icon-theme/LICENSE-seti.txt`.

## Drafts

An open document that differs from its file becomes a draft after the quiet period, 300 ms with no key, and compiles in its place, each key drawn sooner by the keystroke tier, session.md; save, close or undo to the saved text drops it. A draft reads `.pcbjs/cache`, writes only memory. The open text is the session's document store, session.md: the editor holds what it opened, an agent's text never overrides it, and a write on disk under it stays shadowed, with a file warning, until the extension merges it, editor.md.

When esbuild rejects a draft, TypeScript's tolerant parser repairs it, offsets kept: closers appended when the errors are only at the end, else the smallest statement, JSX child, attribute or property around the first error blanked, four drops at most, else the last good board stays, marked stale. Skipped spans are hints, source `pcbjs draft`; the pill reads `draft` or `draft, 1 statement skipped`. Drafts need a language client.

An edit leaving its block with an error holds the compile while the cursor stays there, the status bar reading `pcbjs: holding, pcb.tsx:42 has an error`, editor.md.

## Versions

Each project runs its own CLI, compiler and language server; the extension carries none and serves multiple versions. Newer same-major protocols only add; a newer major prompts once for `pcbjs ide install` there.

The extension's major and minor track `@pcbjs/pcbjs`. The Marketplace takes only `x.y.z`: a train `x.y.z-beta.n` is `x.y.(1000z + n)`, a release `x.y.(1000z + 999)`, so pcbjs `0.1.0` bundles extension `0.1.999` as a stable release. Earlier `0.0.1-beta.4` maps to `0.0.1004`, published as a pre-release.

## Building it

`npm run package -w @pcbjs/vscode` builds the `.vsix` into `packages/cli/vscode`; development.md has the rest.

Each preview pane keeps its current session, project, board and target context. Switching projects or servers replaces that context for checks as well as drawing views. Finding navigation reuses the checks pane without reopening it. Closing the last checks pane for that context clears finding focus only in its connected owning session; disconnected or superseded sessions receive no close action.
