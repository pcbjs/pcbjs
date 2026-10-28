# pcbjs for VS Code

This extension runs the pcbjs dev server for you, shows the viewer in a panel beside the editor, and links the two both ways.

Cursor to viewer: as you move the cursor in a `.ts` or `.tsx` file of a pcbjs project, the viewer highlights the element that the code under the cursor produced.

Viewer to editor: when you cmd+click an element in the viewer, the extension opens the source file and selects the exact expression, centred in the editor. For a part of a footprint that is the placement, the call that placed the footprint; shift+cmd+click selects the definition, the innermost expression that drew it. A track, zone, via or graphic selects its own expression either way.

Focus: when you switch to another file of the project, the preview shows the board that file belongs to.

Language features: hovers, code lenses with route lengths and findings, inlay hints with the net of a pad and the width a route got, DRC and ERC findings in Problems, go to definition and highlights, all from the language server inside the dev server.

Inline editors: every value the server can edit gets a dotted underline and a quick pick of the server's choices, in the manner of the colour picker for CSS colours. See Inline editors below.

## How it works

The extension is the host. On activation it listens on `ws://127.0.0.1:<random port>/<random token>` and accepts only that exact path. When you open the preview or start the server, it spawns one dev server for every workspace folder:

```sh
<dir>/node_modules/.bin/pcbjs dev --workspace <folder>... --ide=ws://127.0.0.1:<port>/<token> --port 0 --host 127.0.0.1
```

The server finds every project, a directory with a `pcb.config.*`, under the folders and loads one only when the preview shows it or you focus a file in it. Each project lists its boards in `entries` in its own config.

The dev server dials that URL, says where it listens and which boards it compiled, and keeps the connection open, reconnecting with backoff if it drops. Its terminal output goes to the pcbjs output channel. If it crashes, the extension restarts it with a growing delay and gives up after five crashes in a row. Stopping the server, closing the workspace or quitting VS Code kills it.

A project is a directory with a `pcb.config.*` file, or one under the old name `pcbjs.config.*`. The extension starts the server when a workspace folder holds a project or has pcbjs installed. It runs the project's own pcbjs, `node_modules/.bin/pcbjs` of each project and then of each parent directory, then of each workspace folder, so a monorepo with one install at its root works; when the link resolves to a script it runs under the node of `pcbjs.nodePath`. Without a local install it runs a global `pcbjs` from PATH and says so once, since that one's version may not match the project; without either it asks you to run `npm install --save-dev @pcbjs/pcbjs`.

## Versions

The extension carries no pcbjs: every project runs its own CLI, compiler and language server, so one extension serves projects on different pcbjs versions. The extension and the dev server state a protocol number, a major and their capabilities when they connect. A newer server of the same major only adds, and the extension ignores what it does not know. A server of a newer major shows one notice: run `pcbjs ide install` in that project to install the extension bundled with its pcbjs.

The extension's version tracks the major and minor of `@pcbjs/pcbjs` that bundles it, so extension 0.1.x ships with pcbjs 0.1.x; a patch on either side changes no protocol. docs/ide-bridge.md has the protocol table.

The Marketplace takes only `x.y.z`, so the package script maps the train version of `packages/vscode/package.json` to the extension's version: a pre-release `x.y.z-beta.n` becomes `x.y.(1000z + n)` and a release `x.y.z` becomes `x.y.(1000z + 999)`, so `0.0.1-beta.0` is `0.0.1000`, `0.0.1-beta.4` is `0.0.1004` and `0.0.1` is `0.0.1999`. The mapping keeps major and minor, orders like the train versions, and allows 999 betas per patch. A pre-release VSIX is packaged and published as a pre-release. The Marketplace and Open VSX get the same VSIX that `@pcbjs/cli` ships.

The preview is panes: webview panels, each its own editor tab with one view, 2D, 3D or Schematic, that it never changes. Each loads the dev server's URL with `?ide=1&theme=<dark|light|hc>&view=<2d|3d|sch>&panel=0`. In that mode the viewer has no home page, header or view switcher, only one floating row of buttons, and shows one board at a time. The theme follows the VS Code colour theme. The extension tells the server which file is active, and the server works out the project and the board through its module graph, so the panel follows the editor into another project without the extension knowing the boards. When the server fails to start, the panel shows its last 40 output lines and a Restart button. Each tab shows the pcbjs preview icon and the board and the view, such as `Blinky | 3D`, or `Blinky | 3D (2)` for a second pane of a view, and keeps its view when VS Code reloads. A pane keeps its page while hidden, and a new one loads the viewer at once when the server runs.

## Sidebar

The pcbjs icon in the activity bar opens four views, which hold what the viewer's right-hand panel shows in a browser, so the tabs show only the board:

- Boards: the boards of the project shown, or for a workspace server its projects with the shown one open. A click shows a board, or loads a project, in every tab; the inline 2D, 3D and schematic buttons of a board open that view of it.
- Findings: DRC and ERC findings of every board, under Errors, Warnings and Info. A click pans the open tabs to the finding and opens its code.
- Nets: the nets of the board shown with their pad counts. A click pins the net in every tab; a second click unpins it.
- BOM: one row per BOM line. A click opens the placement of its first part.

In a workspace without a pcbjs project the Boards view shows Create project, Convert from KiCad and Install skills; its `...` menu keeps them later.

The create and convert commands run the pcbjs installed nearest the target folder or in a workspace folder, else a global `pcbjs`, else `npx --package @pcbjs/pcbjs pcbjs`, under a progress notification that shows each line, with the full output in the pcbjs output channel. When no pcbjs resolves from the new project they run `npm install` there, so its dev server can start, then restart a running dev server that does not know the project yet. A project outside the workspace is added as a folder.

The views read the `pcbjs:ide:boards` event and each board's `board.json` from the dev server after every compile.

## Language server

Once the dev server reports in, the extension starts a language client on the same connection. The dev server then loads `@pcbjs/lsp`, which @pcbjs/pcbjs installs, and answers hovers, definitions, highlights, code lenses, inlay hints and diagnostics for every `.ts` and `.tsx` file under the workspace folders. The extension itself knows nothing about boards, values or path grammars: the server sends each editable value with the widget it wants, so a new kind of value needs no new extension. docs/ide-bridge.md has the protocol.

A dev server without the language server, an older pcbjs or one started by hand, still gets cursor sync, focus and viewer clicks through the plain events.

## Inline editors

The server reports every value it can edit as a segment: positions, rotations, lengths, layers, sides, copper counts, numbers such as an impedance, pad references, and each command of a route path, of SVG path data or of a route chain such as `.V(14)`. Each gets a faint dotted underline. With the cursor on one, the light bulb offers "pcbjs: edit", and `pcbjs: Edit value` opens the same from the palette, the context menu or a key binding.

The editor is the same for every kind: a quick pick of the choices the server computed, each with the edit it makes, and, when the widget the server sent takes a typed value, a `Type a value...` entry. The input box asks the server about every keystroke and shows its reason when the value cannot be written, such as a curve in a route path or a pad the part does not have. A choice of one, such as flipping a side, applies at once.

Every edit is one ordinary text edit, so undo and redo work as for typing. With `pcbjs.editorAutoSave` on, the default, the document is saved after each edit, so the dev server recompiles and the preview follows.

## Commands

- `pcbjs: Open 2D beside`, `Open 3D beside` and `Open schematic beside`, also in the title bar of a pane and of a board entry, and on ctrl+alt+2, ctrl+alt+3 and ctrl+alt+s, cmd+alt on macOS, in a pcbjs project: open that view in the editor group to the right, or reveal and focus its pane where it is, also from a pane of the same view.
- `pcbjs: Open another 2D view beside`, and 3D and schematic, the same actions with Alt held, the board buttons in the sidebar included, or with Shift added to the keys: always a new, numbered pane. VS Code menus offer Alt as the only modifier.
- `pcbjs: Open 2D, 3D and schematic side by side`, `pcbjs.openAllViews`: the two other views beside a pane, or all three beside the code, each in its own group.
- `pcbjs: Open a view of the board`, also the status bar item: a quick pick of the three views and all three.
- `pcbjs: Open 2D view`, `pcbjs: Open 3D view` and `pcbjs: Open schematic view` open or reveal that view's pane for the project of the active file, starting its dev server first if needed; `pcbjs: Toggle preview in the last used view` opens or closes the view whose pane last had focus.
- `pcbjs: Reload preview`, also the refresh button in a preview tab's title bar, reloads that tab's viewer at its current page, or every tab from the palette, reconnects a dev server started by hand, sends the focus and cursor again, and starts the dev server when it is gone.
- `pcbjs: Start dev server`, `pcbjs: Stop dev server` and `pcbjs: Restart dev server` act on the project of the active file, or ask which project when that is unclear.
- `pcbjs: Open in browser` opens the viewer in the default browser.
- `pcbjs: Toggle cursor sync` turns the cursor to viewer direction on or off.
- `pcbjs: Show output` shows the pcbjs output channel.
- `pcbjs: Edit value` opens the editor for the value under the cursor, see Inline editors.
- `pcbjs: Use the pcbjs file icons in Material Icon Theme or vscode-icons` writes that theme's custom associations, see File icons.
- `pcbjs: Remove pcbjs file icons` undoes every file icon change, whatever theme is active: it removes the Material Icon Theme and vscode-icons associations it wrote, keeping yours, clears `vsicons.customIconFolderPath` when it points into the extension, switches the "pcbjs" theme back to the one before or to `vs-seti`, and lets the offer show again.
- `pcbjs: Create project in workspace` runs `pcbjs create` in the only workspace folder, a folder you pick among several, or one an open dialog picks when the window has none. It asks for the project folder, `board` or the first free `board-2`, or `.` when the folder is empty, then opens `pcb.tsx` and its 2D preview.
- `pcbjs: Convert from KiCad` lists every `.kicad_pro` of the workspace outside `node_modules` and `.pcbjs`, by relative path with its board file below; a single one is preselected so you confirm it, and with none an open dialog asks for one. Only a project with the `.kicad_pcb` of its name beside it converts; the others are listed with that reason and refused when picked. It runs `pcbjs import board <board> -o pcb.tsx` in a folder you confirm, by default `<name>-pcbjs` beside the KiCad project's folder, or inside that folder when it is a workspace root, then opens the result.
- `pcbjs: Install skills` runs `pcbjs skills install` with the project's own pcbjs in the only project, or one you pick, and shows the lines it printed. When the project has no pcbjs or no `@pcbjs/skills` resolves from it, it says so and offers `npx @pcbjs/skills install`, run or copied.
- `pcbjs: Connect to an externally started dev server` and `pcbjs: Disconnect from externally started dev servers` control the fallback below.

The status bar item shows the state of the current project's server: a spinner while starting, a board icon while running, an error icon after a failure, a plug icon for an external server. Its tooltip lists every project.

## File icons

VS Code shows file icons only through one file icon theme, which replaces yours, so the extension fits in with the active one on activation and when `workbench.iconTheme` changes:

- Material Icon Theme: it writes `material-icon-theme.files.associations` for `pcb.tsx`, `*.pcb.tsx`, `*.sch.ts`, `*.sch.tsx` and `pcb.config.ts`, `.mts`, `.js` and `.mjs`, and `material-icon-theme.folders.associations` for the `.pcbjs/fab` folder, each a path to the icon in this extension relative to Material's `dist` folder, as Material requires.
- vscode-icons: it writes the same patterns to `vsicons.associations.files` and `vsicons.associations.folders`, with light versions, and `vsicons.customIconFolderPath` to this extension's icons.
- Both go to the user settings, only when a key is missing or points at an older install, keeping your own associations. A status bar message, "pcbjs: file icons added to Material Icon Theme", stays 20 s; a click on it undoes, removing exactly the keys it wrote.
- Any other theme: one notice offers the "pcbjs" file icon theme with a button that switches to it. Dismissed, it never asks again.

The file icon theme "pcbjs", picked with Preferences: File Icon Theme, is VS Code's own Seti theme with the pcbjs icons on top, each in a light and a dark version:

- config: `pcb.config.ts`, `.mts`, `.js`, `.mjs` and the old `pcbjs.config.*`.
- schematic: `*.sch.ts` and `*.sch.tsx`.
- entry: `pcb.tsx`, `*.pcb.tsx` and every file named in `entries` of a project's config, globs expanded.
- footprint: `.ts` and `.tsx` files in a `lib` folder, and modules that call `defineFootprint`. An entry wins over this rule.
- fab: the fab zip. The theme has no folder icons, as Seti has none: a folder icon makes VS Code indent every file row past the folder chevrons.

The fixed patterns are in the theme as built. The extension adds the entries, footprint modules and fab zips of the projects it finds, by folder and name, and rewrites the theme when a config or the fab output changes; VS Code reloads it at once.

`pcbjs: Use the pcbjs file icons in Material Icon Theme or vscode-icons` is the manual form, with that theme active. It also lists every entry and footprint module of the projects by name, and writes `material-icon-theme.files.associations` and `material-icon-theme.folders.associations`, or `vsicons.associations.files`, `vsicons.associations.folders` and `vsicons.customIconFolderPath`, to the icons inside this extension, keeping your own associations. Neither theme has a rule for a folder, so `lib` modules are listed by name. Run it again after an update of this extension, which moves its folder, or after adding an entry.

The Seti part, `assets/icon-theme/seti.json` and `seti.woff`, comes from the microsoft/vscode repository under the MIT licence; `assets/icon-theme/LICENSE-seti.txt` holds that licence and Seti UI's notice.

## Settings

- `pcbjs.autoStart`, default false: start the dev server when the workspace opens. When off, it starts with the first preview.
- `pcbjs.cursorSync`, default true: send the cursor position to the dev server.
- `pcbjs.followFocus`, default true: send the active file to the dev server, so the preview switches boards with the editor.
- `pcbjs.nodePath`, default empty: the node binary that runs pcbjs. Empty means `node` from PATH, then `/opt/homebrew/bin` and `/usr/local/bin`. pcbjs needs Node 22.12 or newer.
- `pcbjs.followDevJson`, default true: look for dev servers started by hand through `.pcbjs/dev.json`. Off leaves them alone, such as one a test or a script starts; the command Connect to an externally started dev server still connects.
- `pcbjs.autoConnect`, default true: connect to externally started dev servers as soon as they are found.
- `pcbjs.editorAutoSave`, default true: save the document after each edit from an inline editor.

Inlay hints follow VS Code's own `editor.inlayHints.enabled`.

## Externally started servers

A dev server you start yourself with `pcbjs dev` in a terminal still works. It writes `.pcbjs/dev.json` in the project on start and deletes it on exit. The extension watches every workspace folder for that file and connects over the Vite HMR WebSocket of that server, the way earlier versions of the extension did. Cursor sync, focus and cmd+click selection work the same, and the preview shows that server instead of starting a second one. While the extension's own server runs, it covers every project of the workspace and a server started by hand inside it is left alone.

When the extension runs a server for a project itself, it ignores that project's `dev.json`, so a project never gets two connections and a cmd+click never selects twice.

## Install

The @pcbjs/cli npm package, which @pcbjs/pcbjs installs, ships a built copy at `node_modules/@pcbjs/cli/vscode/vscode-pcbjs.vsix`. Install it with `pcbjs ide install`, with `code --install-extension node_modules/@pcbjs/cli/vscode/vscode-pcbjs.vsix`, or with "Extensions: Install from VSIX..." in VS Code.

To build the VSIX yourself, run `npm run package -w @pcbjs/vscode` from the repository root. It builds the extension, copies the brand icons of `site/brand/icons/light` and `dark` into `assets/icons`, builds the icon theme from Seti, fetched once from microsoft/vscode into `node_modules/.cache/pcbjs-seti` with its licence and failing when it cannot be fetched, and calls `npx @vscode/vsce package`, writing `vscode-pcbjs-<version>.vsix`, a stable `vscode-pcbjs.vsix` copy and `manifest.json` into `packages/cli/vscode`. vsce is fetched by npx, so the first run needs network access.

To develop, open `packages/vscode` in VS Code, run `npm run build -w @pcbjs/vscode`, and press F5 to start an Extension Development Host with the extension loaded. `npm test -w @pcbjs/vscode` runs the host, server, sync, fallback bridge and language client tests under plain Node, against mock dev servers, a mock language server and a fake spawn and editor, without VS Code.

The source is split by job: `host.ts` is the WebSocket server, `server.ts` spawns and supervises one dev server, `language.ts` starts the language client on a hosted connection, `lsp-client.ts` holds its transport, handshake options and the custom messages without vscode, `sync.ts` relays cursor and focus, `preview.ts` is the panel, `icons.ts` and `icon-map.ts` the file icons, `segments-ui.ts` the underlines and the editor, `setup.ts` the create, convert and skills commands, `fallback.ts` and `bridge.ts` the `dev.json` fallback, `protocol.ts` the event types, and `extension.ts` wires them to VS Code.

## Without the extension

Cmd+click in the viewer still works: the dev server opens the position with `code --goto file:line:col`. That moves the cursor to the start of the expression but cannot select a range, and nothing flows from the editor to the viewer.
