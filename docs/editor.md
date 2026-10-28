# Editor

Source links from the viewer to the code, repository links in a built site, the VS Code extension, and IDE mode with the viewer inside the editor.
The wire protocol for writing a bridge for another editor is in ide-bridge.md.

## Source links

Every item in the viewer knows the code that drew it. A Vite transform gives each JSX element and each `route`, `pour`, `via` or `stitch` call its range, indexed in the site data's `sources`.

- A click on an item selects it and opens its code: in the editor in dev, on the repository host in a built site.
- An item of a footprint, in 2D or its body in 3D, opens the placement: the outermost call that placed it, such as `<Q1 at="26 10" />` in blinky.pcb.tsx.
- Shift+click opens the definition: the innermost range, such as the `<pad>` line in lib/MyPart.tsx for a pad of Q1.
- A track, via, pour or graphic outside a footprint opens its own call either way, a stitched via its `stitch()`.
- A path is linked command by command: each of `L`, `H`, `V`, `Z`, `@<layer>`, `X` and `XZ` links to the tracks and vias it made. A click opens and selects that command, shift+click the whole call. A path string must be a plain literal.
- In dev, the editor cursor highlights what the code under it drew, on the board, in 3D and in the schematic: a part element or `<Sym>` inside `<Schematic>`, a `<Label>`, `<Power>`, `<Sheet>` or `wire()` chain outlines what it drew there and its parts on the board. A chip names the file, line and item count, for one path command also the column and the command, as in `pcb.tsx:<line>:<col> H 9`. A cursor counts as inside a range strictly between its first and last character, so just before `<R1/>`, after its `>` or after a call's `)` is outside. The highlight follows the cursor once per frame, clears when it leaves every range or a non-design file takes focus, and stays while the preview is focused. With the language server the innermost token wins, see Symbols under the cursor, and the chip names it, as in `pad Q1.2`.
- The readout names the click target with the hint `Click: placement · ⇧-click: definition`; the Part tab links the placement, the definition when elsewhere, and Show in source.

`editor.follow` in the config sets the gesture. `'click'`, the default, opens on a plain click. `'meta-click'` makes a plain click only select, and cmd+click, ctrl+click off macOS, open the source.

## Symbols under the cursor

The token under the cursor, a part, pad, net, group, point or reference, picks what the highlight and the hover show; highlight.md has the table and how source ranges are recorded.

## Repository links

`repo` in the config turns on source links in a built site. Without it a click only selects and the range shows as text. The dev server ignores `repo`.

`repo` takes the repository URL, or `{ url, ref, dir, kind }`:

- `kind` comes from the host: `github` for github.com, `gitlab` for gitlab.com or a URL with `/-/`, `gitea` for a host with gitea in its name or codeberg.org, `bitbucket` for bitbucket.org, `generic` otherwise.
- SSH remotes such as `git@github.com:org/name.git` become https URLs.
- `ref` defaults to the current branch, the commit on a detached HEAD, or `main` outside git.
- `dir` is the path from the repository root to the project, from `git rev-parse --show-prefix` by default.

| Kind | Link |
| --- | --- |
| `github` | `<url>/blob/<ref>/<dir><file>#L<start>-L<end>` |
| `gitlab` | `<url>/-/blob/<ref>/<dir><file>#L<start>-<end>` |
| `gitea` | `<url>/src/<ref>/<dir><file>#L<start>-L<end>` |
| `bitbucket` | `<url>/src/<ref>/<dir><file>#lines-<start>:<end>` |
| `generic` | `<url>/<dir><file>#L<start>` |

## The VS Code extension

The @pcbjs/cli package, which @pcbjs/pcbjs installs, ships the extension as `vscode/vscode-pcbjs.vsix`, built from `packages/vscode`.

- `pcbjs ide install` runs `code --install-extension` with the bundled VSIX. Without `code` on PATH it prints the command and the Install from VSIX route.
- `pcbjs ide status` prints the bundled id and version and the installed version.
- `pcbjs dev` run in the VS Code terminal prints one hint line when the extension is missing or outdated. It never installs anything.
- `pcbjs: Create project in workspace`, `Convert from KiCad` and `Install skills` run `pcbjs create`, `import board` and `skills install`; the Boards view offers them in a workspace without a project.
- The pcbjs sidebar holds what the viewer's side panel shows, so the panes show only the board: Boards, under their projects on a workspace server, a click shows one in every pane; Findings by severity, a click pans the panes and opens the code; Nets, a click pins one everywhere; BOM, a click opens the placement.

The extension is a thin client: it starts the project's own `node_modules/.bin/pcbjs`, relays focus, shows what the server sends and applies the edits it computes. A project of a newer protocol major shows one notice to run `pcbjs ide install` there. In a `.ts` or `.tsx` file of a project:

- Hover: a preview image first, then the value under the cursor, such as `x 3 mm, y 7.46 mm`, and what the code drew: `Drew 3 tracks, 1 via on Blinky · net VCC`, the route's length and target, and its findings. The image is a 360 px crop of the board's 2D view, highlight.md has what it shows for each kind of code.
- Code lenses above each route call with its length, target, match group and pair skew, and above each call with DRC or ERC findings their count and rules.
- Inlay hints after a pad reference with its net, `net GND`, and after a route that names no width with the width the rules or its net class gave it.
- Problems: every DRC and ERC finding with a source, at the code that made it, and the spans a draft skipped.
- Go to definition on a placement opens the footprint's definition, inside a footprint its placement, on a pad reference such as `'U1.3'` the part's placement.
- Highlights: the call under the cursor and other code of the file that drew the same items.
- Inline value editors: every value the server can edit has a dotted underline. The light bulb or `pcbjs: Edit value` opens a quick pick of the server's choices plus `Type a value...`, checked as you type; each choice is one ordinary edit, so undo works; `pcbjs.editorAutoSave` saves the file so the board recompiles.

A route path is edited command by command, in a string or a chain: `.V(14)` offers `.H(14)`, a via after it and delete, and typing `V 16` writes `.V(16)`.

File icons: on activation the extension adds the board, schematic and config icons to Material Icon Theme or vscode-icons in the user settings when missing or stale, with an Undo in the status bar, and offers the pcbjs icon theme once under any other theme. `pcbjs: Use the pcbjs file icons in Material Icon Theme or vscode-icons` does it by hand, `pcbjs: Remove pcbjs file icons` undoes it.

packages/vscode/README.md lists the extension's commands and settings.

## Panes

A pane is an editor tab with one board view, 2D, 3D or Schematic, and never changes view. Its title follows the board, `Blinky | 3D`, and keeps its view across reloads.

- A pane's title bar, and that of a board entry, has Open 2D, 3D and schematic beside and `pcbjs.openAllViews`: the two other views beside a pane or all three beside the code.
- A view already open is revealed and focused, from its own pane too. Only Alt+click on a view button, Shift with the keys or New pane in the status pick opens another, numbered `Blinky | 3D (2)`.
- In a project ctrl+alt+2, ctrl+alt+3 and ctrl+alt+s open 2D, 3D and schematic beside, cmd+alt+2, 3 and s on macOS.
- The status bar item offers the three views and all three; each board in the sidebar has inline 2D, 3D and schematic buttons. The palette keeps `Open 2D view`, `Open 3D view`, `Open schematic view` and `Toggle preview in the last used view`.
- The refresh button, also `pcbjs: Reload preview`, reloads a pane, resyncs focus and restarts a stopped dev server.
- A pane shows the viewer's loading screen until the server runs, then the viewer, kept while hidden; a compile never delays it. Start and Show output appear only when the server is still stopped after 2 s.
- Code opened from a pane, a Findings or BOM row or a hover opens in another group, one showing the file, else the last used; with none, a group opens left of the pane, above it when the pane is taller than wide. The file's tab behind the pane moves out first.

## Schematic names in the editor

`@pcbjs/ts-plugin` lets the TypeScript server see what `<PCB schematic={sch}>` puts in scope, see schematic.md: hover, completion, go to definition, rename and errors on `U1.VSSA` work as on an imported name, and `U9` the module lacks reads `U9 is not exported by ./board.sch`.

- VS Code: the extension ships the plugin, nothing to set up. It applies to the bundled TypeScript and to a workspace version alike.
- Other editors on tsserver, such as Neovim, Zed or WebStorm: `"plugins": [{ "name": "@pcbjs/ts-plugin" }]` in `compilerOptions`, as `pcbjs create` writes it; @pcbjs/pcbjs installs the plugin.
- Without it the editor reports `Cannot find name 'U1'` with no type behind it; `pcbjs check` stays the type check to trust.

## IDE mode

The extension is the host. It runs a WebSocket server on 127.0.0.1 and starts one `pcbjs dev --workspace <folder>... --port 0 --ide=ws://127.0.0.1:<port>/<token>` for all workspace folders; a project loads when the preview shows it or one of its files has focus, see workspace.md. The dev server dials in with its port, projects, boards and log, and the extension starts a language client on the same connection.

The viewer runs in an editor panel at `/?ide=1&theme=dark`, `light` or `hc`, with `view` and `panel=0` in VS Code: `view` fixes the view, no header, one floating row of buttons, the layers rail as a drawer and no home page. It shows one board at a time and follows the editor:

- A file in the module graph of exactly one board shows that board.
- A file shared by several boards keeps the board shown when it is one of them, else shows the first in entry order.
- A file no board imports shows an isolated preview of its default export: a `<PCB>` as it is, a part at the origin, a circuit instance through a layout the file exports or its parts in a row, or a layout with every port on a net of its own. It is a transient board `preview:<file>` under `/__pcbjs/preview/<file>/`, never built and never on the home page.
- A file with nothing to preview changes nothing.
- A file of another project first switches the server to that project, and the panel loads its page; then the rules above apply. A file in no project changes nothing.

A dev server started by hand works through the fallback bridge, found through `.pcbjs/dev.json` and spoken to over its Vite WebSocket, with cursor sync, focus and viewer clicks, no language server, drafts or sidebar. It is left alone while the extension's own server runs. `pcbjs.followDevJson`, on by default, turns that search off for tests and scripts with their own; Connect to an externally started dev server works either way.

## Drafts

The preview compiles what the editor holds: an open document that differs from its file becomes a draft 200 ms after the last change and compiles in place of the file. A save, a close or an undo to the saved text drops it. A draft compile reads `.pcbjs/routes` but never writes it.

pcbjs judges a draft with TypeScript's tolerant parser but never prints its tree, which would move offsets. When esbuild rejects a draft:

1. Errors only at the end of the file, a string, call or JSX tag still open: the closers are appended, innermost first.
2. Else the smallest statement, JSX child, attribute or object property around the first error is blanked, newlines kept; an element closed nowhere loses its opening tag. Four drops at most.
3. If nothing compiles, the last good board stays, marked stale.

Blanking keeps offsets, so highlights and clicks point at the editor's text. Skipped spans are faded hints, source `pcbjs draft`; the viewer's pill reads `draft` or `draft, 1 statement skipped`. Unrepairable: more than four errors, an error only the whole default export encloses, and text that parses but fails to run. Drafts come through a language client; the dev.json fallback has none.
