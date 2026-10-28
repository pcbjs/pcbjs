# Editor

Source links from the viewer to the code, repository links in a built site, the VS Code extension, and IDE mode with the viewer inside the editor.
The wire protocol for writing a bridge for another editor is in ide-bridge.md.

```ts
// pcb.config.ts
import { defineConfig } from '@pcbjs/core'

export default defineConfig({
  entries: ['pcb.tsx'],
  repo: { url: 'https://github.com/org/name', ref: 'main', dir: 'boards/', kind: 'github' }, // source links in a built site
  editor: { follow: 'meta-click' }, // default 'click'
})
```

## Source links

A click selects an item and opens its range from the site data's `sources`: in the editor in dev, on the repository host in a built site.

| Clicked | Click opens | Shift+click opens |
| --- | --- | --- |
| a footprint item in 2D, its body in 3D | the placement, `<Q1 at="26 10" />` | the definition, the `<pad>` in lib/MyPart.tsx |
| a track, via, pour or graphic outside a footprint | its call; a stitched via its `stitch()` | the same |
| a track or via of a path | its command, `L`, `H`, `V`, `Z`, `@<layer>`, `X` or `XZ` | the whole call |

- A path string must be a plain literal. `editor.follow: 'meta-click'` makes a click only select and cmd+click, ctrl+click off macOS, open.
- The readout hints `Click: placement · ⇧-click: definition`; the Part tab links placement, definition and Show in source.

In dev the cursor highlights what its code drew in 2D, 3D and the schematic, from a part element, `<Sym>` in `<Schematic>`, `<Label>`, `<Power>`, `<Sheet>` or `wire()` too:

- A chip names file, line and item count, for a path command the column and command, `pcb.tsx:<line>:<col> H 9`; with the language server the token, `pad Q1.2`.
- A cursor is inside a range strictly between its first and last character: before `<R1/>`, after its `>` or a call's `)` is outside.
- It follows once per frame, clears when the cursor leaves every range or a non-design file takes focus, and stays while the preview has focus.

## Repository links

`repo` takes a URL or `{ url, ref, dir, kind }`; without it a built site only selects and shows the range as text. The dev server ignores it.

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
- `pcbjs: Create project in workspace`, `New board wizard`, `New project from an example`, `Convert from KiCad` and `Install skills` run `pcbjs create`, `import board` and `skills install`, from the Boards view and the Get started walkthrough.
- The sidebar: Boards, under their projects on a workspace server, a click shows it in every pane; Findings by severity, a click pans and opens the code; Nets, a click pins everywhere; BOM, a click opens the placement.
- It starts the project's `node_modules/.bin/pcbjs`; a newer protocol major shows one notice to run `pcbjs ide install`.

In a `.ts` or `.tsx` file of a project:

| Feature | Shows |
| --- | --- |
| Hover | a 360 px preview, see highlight.md, then the value, `x 3 mm, y 7.46 mm`, what it drew, `Drew 3 tracks, 1 via on Blinky · net VCC`, length, target and findings |
| Code lenses | above a route: length, target, match group, pair skew; above a call with findings: count and rules |
| Inlay hints | after a pad reference its net, `net GND`; after a route with no width the width it got |
| Problems | every finding with a source, and the spans a draft skipped |
| Go to definition | placement to footprint definition, inside a footprint to its placement, `'U1.3'` to the placement |
| Highlights | the call under the cursor and code that drew the same items |
| Value editors | a dotted underline; the light bulb or `pcbjs: Edit value` opens the server's choices plus `Type a value...`; each is one undoable edit; `pcbjs.editorAutoSave` saves so the board recompiles |

A path is edited per command, in a string or a chain: `.V(14)` offers `.H(14)`, a via after it and delete; typing `V 16` writes `.V(16)`.

Activation adds file icons to Material Icon Theme or vscode-icons, with Undo, or offers the pcbjs icon theme; `pcbjs: Use the pcbjs file icons in Material Icon Theme or vscode-icons` and `pcbjs: Remove pcbjs file icons` do it by hand. packages/vscode/README.md lists every command and setting.

## Panes

A pane is an editor tab with one fixed view, titled `Blinky | 3D`, kept across reloads.

| Way | Opens |
| --- | --- |
| title bar buttons, `pcbjs.openAllViews` | 2D, 3D or schematic beside; the other two, or all three beside the code |
| ctrl+alt+2, ctrl+alt+3, ctrl+alt+s, cmd+alt on macOS | 2D, 3D, schematic beside |
| `Open 2D view`, `Open 3D view`, `Open schematic view`, `Toggle preview in the last used view` | from the palette; the status bar item and sidebar buttons too |
| refresh, `pcbjs: Reload preview` | reloads, resyncs focus, restarts a stopped server |

- An open view is revealed, not duplicated; Alt+click, Shift with the keys or New pane opens another, `Blinky | 3D (2)`.
- Start and Show output appear when the server is still stopped after 2 s.
- Code opened from a pane goes to a group showing the file, else the last used, else a new group left of the pane, above when it is taller than wide.

## Schematic names in the editor

`@pcbjs/ts-plugin` shows the TypeScript server what `<PCB schematic={sch}>` puts in scope: hover, completion, rename and errors on `U1.VSSA`, and `U9 is not exported by ./board.sch`. VS Code ships it; tsserver editors such as Neovim, Zed or WebStorm add it as `pcbjs create` does:

```json
{ "compilerOptions": { "plugins": [{ "name": "@pcbjs/ts-plugin" }] } }
```

Without it the editor reports `Cannot find name 'U1'`; `pcbjs check` stays the type check to trust.

## IDE mode

The extension hosts a WebSocket on 127.0.0.1 and starts `pcbjs dev --workspace <folder>... --port 0 --ide=ws://127.0.0.1:<port>/<token>`, which dials in; a language client shares the connection. The panel shows `/?ide=1&theme=dark`, `light` or `hc`, with `view` and `panel=0`: no header, a floating button row, the layers rail as a drawer.

| Focused file | Shows |
| --- | --- |
| in the graph of one board | that board |
| shared by several | the shown board when it is one, else the first in entry order |
| imported by no board | a preview `preview:<file>` of its default export under `/__pcbjs/preview/<file>/`: a `<PCB>`, a part at the origin, a circuit through its layout or parts in a row, a layout with a net per port; never built |
| in another project | switches project, then the rules above |
| nothing to preview, or in no project | no change |

A hand-started dev server is reached through `.pcbjs/dev.json` and its Vite WebSocket while the extension's own is not running: cursor, focus and clicks only. `pcbjs.followDevJson` off stops that search; Connect to an externally started dev server works either way.

## Drafts

An open document that differs from its file becomes a draft 200 ms after the last change and compiles in its place; save, close or undo to the saved text drops it. A draft reads `.pcbjs/routes` but never writes it.

When esbuild rejects a draft, TypeScript's tolerant parser repairs it, offsets kept:

1. Errors only at the end, a string, call or JSX tag open: closers appended, innermost first.
2. Else the smallest statement, JSX child, attribute or property around the first error is blanked, newlines kept; an element closed nowhere loses its opening tag. Four drops at most.
3. Else the last good board stays, marked stale.

Skipped spans are hints, source `pcbjs draft`; the pill reads `draft` or `draft, 1 statement skipped`. Unrepairable: more than four errors, an error only the default export encloses, text that parses but fails to run. Drafts need a language client.
