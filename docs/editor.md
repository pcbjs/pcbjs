# Editor

The selection between the viewer and the code, repository links in a built site, and the VS Code extension: installing it, its panes and what it shows in code.
Basic. vscode.md has how the extension connects, its sidebar, commands, settings and drafts; ide-bridge.md the protocol for another editor.

```sh
npx pcbjs ide install   # the VS Code extension bundled with the project's pcbjs
npm run dev             # the viewer in a browser; what you select there is selected in code
```

## The selection and the code

In dev the viewers, the tree and the editor share one selection per board, viewer.md: a click in a view selects, and the editor jumps to it while focus stays in the view, so typing never lands in code.

- Selecting in a view sets one editor selection per member, a multi-cursor selection with the anchor's first: a part's placement, `<Q1 at="26 10" />`; a pad's key in its connect call, `K` in `.connect({ A: SIG, K: GND })`; a route's call; a pour's `pour()`; a group the span of its parts. When the anchor changed the editor reveals the file beside the view with the cursor there.
- The placement follows the view: a click in 2D or 3D lands on the `at` value of the part's PCB placement, in the schematic on the `at` of its symbol inside `<Schematic>`, never the layout. What has no placement in that view, a net or a route clicked in the schematic, goes to its declaration, `VCC` in `export const { GND, VCC } = nets()`.
- Every cursor and selection in a design file selects what its code made: a token as highlight.md resolves it, a range everything drawn inside it, the primary cursor's member the anchor. A cursor on nothing clears a selection the editor set and keeps one set elsewhere.
- A cursor is inside a range strictly between its first and last character: before `<R1/>`, after its `>` or a call's `)` is outside. It follows once per frame and stays while the preview has focus.
- The chip's Open placement opens the anchor's placement in the chip's own view, on its `at` value, Open definition the innermost range that drew it, the factory or declaration such as the `<pad>` in lib/MyPart.tsx; a path command opens its command in `d` or the chain call, `.H()`, `.V()`, `.via()`. Both give the editor focus. With no editor attached they run `code --goto`; a built site opens them on the repository host; the Part tab links both.
- Cmd or ctrl+Z in a pane uses chronological undo in its named source document. Multiple-file edits require source-editor undo, editor-actions.md.
- In an end slot of `route()` the language server's completion lists the ends the views annotate, with the same labels: after `route(J1[2], ` the terminals of VCC not yet joined to the header, `C1[1]` with `1 · VCC`, and bound route points such as `ch2.vccTrunk.end`; nothing of another net. Typing a part's name filters it; a pick in a view writes the same text, editing.md.
- While the list is open, the item in focus is lit in every view as a hover lights a candidate; it follows the arrow keys and goes when the item is accepted or the cursor leaves the slot. VS Code sends no close event, so after Escape it stays until the cursor moves, ide-bridge.md.

```ts
// pcb.config.ts
import { defineConfig } from '@pcbjs/core'

export default defineConfig({
  entries: ['pcb.tsx'],
  repo: { url: 'https://github.com/org/name', ref: 'main', dir: 'boards/', kind: 'github' },
})
```

`repo` is `{ url, ref?, dir?, kind? }`, each left out found from the work tree and the host; without it a built site shows the range as text. The dev server ignores it.

| Field | Default |
| --- | --- |
| `kind` | `github` for github.com, `gitlab` for gitlab.com or a URL with `/-/`, `gitea` for a gitea host or codeberg.org, `bitbucket` for bitbucket.org, else `generic` |
| `ref` | current branch, the commit on a detached HEAD, `main` outside git |
| `dir` | `git rev-parse --show-prefix` |

SSH remotes such as `git@github.com:org/name.git` become https.

| Kind | Link |
| --- | --- |
| `github` | `<url>/blob/<ref>/<dir><file>#L<start>-L<end>` |
| `gitlab` | `<url>/-/blob/<ref>/<dir><file>#L<start>-<end>` |
| `gitea` | `<url>/src/<ref>/<dir><file>#L<start>-L<end>` |
| `bitbucket` | `<url>/src/<ref>/<dir><file>#lines-<start>:<end>` |
| `generic` | `<url>/<dir><file>#L<start>` |

## The VS Code extension

```sh
pcbjs ide install   # code --install-extension with the bundled vscode/vscode-pcbjs.vsix of @pcbjs/cli
pcbjs ide status    # bundled id and version, installed version
```

- `pcbjs dev` in the VS Code terminal hints when the extension is missing or outdated.
- It runs the project's own pcbjs and connects to its session, starting one when none runs, vscode.md.
- Its sidebar lists the boards, findings, nets and BOM. Rows select as the views do, several with shift or cmd, and the Boards tree reveals the anchor of a selection made elsewhere; a finding's click opens its code. It lists the agents at work and the git worktrees too, vscode.md.
- The status bar shows the installed `@pcbjs/pcbjs`, in the warning colour on a version skew, or `Not installed` with a click to install it; `pcbjs create` writes `.vscode/extensions.json`, so a clone of the project prompts for the extension.

In a `.ts` or `.tsx` file of a project:

| Feature | Shows |
| --- | --- |
| Hover | a 360 px preview, see highlight.md, then the value, `x 3 mm, y 7.46 mm`, what it drew, `Drew 3 tracks, 1 via on Blinky · net VCC`, length, target and findings; on a part handle or its placement the part's pins, a table of pad number, pin name and net as `pcbjs inspect J1` prints it; the docs excerpt last |
| Pad selection hint | placing the caret inside a pad accessor such as `R1[]` opens a numbered footprint in the native parameter hint; a typed pad number or pin name is outlined. Qualified handles and quoted pad numbers work; ordinary arrays do not trigger it. The footprint is shown in its own orientation, independent of placement rotation or board side |
| Code lenses | above a route: length, target, match group, pair skew; above a call with findings: count and rules |
| Inlay hints | after a pad reference its net, `net GND`; after a route with no width the width it got; after each bare number its unit, see Units |
| Problems | every finding with a source, and the spans a draft skipped |
| Go to definition | placement to footprint definition, inside a footprint to its placement, `U1[3]` to the placement |
| Highlights | the call under the cursor and code that drew the same items |
| Value editors | a dotted underline; the light bulb or `pcbjs: Edit value` opens the server's choices plus `Type a value...`; each is one undoable edit; `pcbjs.editorAutoSave` saves so the board recompiles |

A path is edited per command, in a string or a chain: `.V(14)` offers `.H(14)`, a via after it and delete; typing `V 16` writes `.V(16)`.

vscode.md lists every command and setting, and the file icons.

### Units

- Every bare number of a length, position or rotation, in a string or as a number, has its unit as an inlay hint: `at="9 7.5"` reads `9mm 7.5mm`, `.width(0.3)` reads `0.3mm`, a rotation `90deg`. An explicit unit, `"100mil"`, `"45deg"`, `"1.57rad"`, gets none; degrees are the default and radians only written.
- Under a grid a part's position is in grid units: `at="3 4"` under a 100 mil grid reads `3·⊞2.54mm 4·⊞2.54mm`. Hovering the glyph names the grid, its pitch and origin; cmd or ctrl+click on it goes to its `defineGrid`, else to the `grid=` that attaches it. Hovering the number lights the grid in every preview of the board for 3 s, grids.md.
- Inside a coordinate string the numbers, units and layers have colours of their own, `pcbjs.unitNumber`, `pcbjs.unitUnit` and `pcbjs.unitLayer`, set in `workbench.colorCustomizations`. VS Code draws them as decorations from the server's `pcbjs/tokens`, so TypeScript's own colours stay; Neovim, Zed and Helix get them as semantic tokens, lsp.md.

### Holding

While you type, an unsaved file compiles as a draft, vscode.md. An edit that leaves its block with a syntax error, or with a type error once it parses, holds the compile while the cursor stays in the block, and the board shown stays the last one that compiled; the keystroke tier still draws what parses.

- The block is the innermost statement, JSX tag or JSX child around the change in the language server's syntax tree, else the lines of JSX text or between statements it touched; the parse is of the block alone, the type check the file's errors inside it.
- The status bar reads `pcbjs: holding, pcb.tsx:42 has an error`, naming the first error, and the viewer's header the same line; both clear with the next compile.
- It compiles once an edit leaves the block clean, the cursor leaves it, the file is saved or an edit lands in another block; a draft still broken compiles repaired, its skipped spans faded. A clean block never waits.
- An empty chain call, `.H()`, never holds, so the assist can fill it.
- A query through the session, `pcbjs check` among them, compiles a held draft as the repair makes it; check says so in a `held` line.
- The session logs a hold as the event `compile` `{ state: 'held', file, line, snapshot }`, and `session/state` carries `hold { file, line }`, session.md.

### Merges

When the session reports a disk write under a file with unsaved text, the extension merges three ways: the base is the text the editor last had in sync with the disk, then your unsaved text and the disk's.

- Clean: the buffer is reverted to the disk and your changes are applied again on top, the cursor kept on its line, with a notice naming the writer, the event's `by`. Your text stays unsaved, and a save never meets "the file has changed on disk".
- Conflict: VS Code's merge editor opens on the base, your text and the disk's, the file marked with conflict markers; it stays unsaved, so the session compiles it, until you resolve and save.
- Your own save is no merge, and neither side is ever dropped.

### Fabrication

`Fabrication` in the status bar, or `pcbjs: Fabrication`, opens a panel with one card per board and target: a pill, ORDERABLE, BLOCKED or STALE, the zip with its `rev` in the name, its size and sha256, the date and where it came from, and the buttons Build, Reveal zip, Open folder and Copy sha. Build runs `pcbjs build` dated by the last commit through `SOURCE_DATE_EPOCH`, so a set is reproducible. The cards come from the session's check report and refresh on its events, a save and a new zip.

| Blocker | Action |
| --- | --- |
| a DRC or ERC error, an unconnected net; six by name, then a count | Open the finding, Open the Findings view |
| an unsaved file of the board's module graph | Save |
| a file of the graph not committed; none outside git | Open source control |
| no `rev`, so the zip is a dev set | Add rev, `rev="0.1.0"` on the entry's `<PCB>` |
| a failed Gerber self check | Open README-fab |
| no set, a set the last failed build marked `STALE`, of another rev, or older than a file of the board | Build, the pill STALE when nothing else blocks |

The dialog is an editor tab: the modal overlay VS Code uses for its own dialogs is closed to extensions, microsoft/vscode#307835.

## Panes

A pane is an editor tab with one fixed view, titled `Blinky | 3D`, kept across reloads.

| Way | Opens |
| --- | --- |
| title bar buttons, `pcbjs.openAllViews` | 2D, 3D, schematic or DRC/ERC; `openAllViews` opens all four beside the code |
| ctrl+alt+2, ctrl+alt+3, ctrl+alt+s, cmd+alt on macOS | 2D, 3D, schematic beside |
| `Open 2D view`, `Open 3D view`, `Open schematic view`, `Open DRC/ERC view`, `Toggle preview in the last used view` | from the palette; the status bar item too; a board row's buttons run them on that board |
| refresh, `pcbjs: Reload preview` | reloads, resyncs focus, restarts a stopped server |

- An open view is revealed, not duplicated; Alt+click, Shift with the keys or New pane opens another, `Blinky | 3D (2)`.
- Start and Show output appear when the server is still stopped after 2 s.
- Source navigation reuses an eligible existing tab, including a background tab. It skips only the group containing the preview that initiated the action. With no reusable tab, it prefers an ordinary source group, then an inactive preview group, then a new split. New source tabs use native preview-tab behavior; editor-actions.md and vscode.md define focus, pinning and DRC/ERC group selection.

## Schematic names in the editor

`@pcbjs/ts-plugin` shows the TypeScript server what `<PCB schematic={sch}>` puts in scope: hover, completion, rename and errors on `U1.VSSA`, and `U9 is not exported by ./board.sch`. VS Code ships it; tsserver editors such as Neovim, Zed or WebStorm add it as `pcbjs create` does:

```json
{ "compilerOptions": { "plugins": [{ "name": "@pcbjs/ts-plugin" }] } }
```

Without it the editor reports `Cannot find name 'U1'`; `pcbjs check` stays the type check to trust.

The VS Code pad-hint trigger reuses its signature-help response for the matching document version and caret when the native provider opens. The response is consumed once and discarded when ownership or the active hint changes; unrelated TypeScript signature help continues through the normal provider.
