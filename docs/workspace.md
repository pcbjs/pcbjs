# Workspace dev server

`pcbjs dev --workspace [folder...]`: one session for every project under some folders, each loaded on first use, with its own routes, defaults and compile state.
Advanced. Read it to serve a monorepo or several projects at once; the VS Code extension attaches to this session for the whole workspace, see vscode.md and session.md.

```sh
pcbjs dev --workspace a b [-p <port>] [--host [host]] [--open] [--verbose]
pcbjs dev --workspace          # the working directory
```

`--workspace` is a switch: the arguments of `dev` are then folders, not entries. Each project uses its own config, so `--config` does not apply; other flags are those of `pcbjs dev`. `build` and `check` stay per project. Every session serves its projects as scopes: `pcbjs dev` in one project is a workspace of that one, and a project of the same checkout attached later joins as one more scope, see session.md.

Git worktree paths use native filesystem separators. Ignored project discovery uses null-delimited Git input and output, including paths with spaces.

## Scopes

Windows editor paths, Vite's forward-slash paths and drive-letter case differences identify the same project files. Saved imports and config changes update the affected scopes; source navigation and `pcbjs check` use the same path comparison. Schematic shorthand names are bound during type checking with either native Windows or TypeScript path separators. POSIX paths retain their case and separator semantics.

- A scope is a directory with a `pcb.config.*`, outside `node_modules` and hidden folders. Start only lists directories and prints each scope's route.
- A scope loads when a viewer opens its page or the editor focuses a file in it: its config through Vite, then its `entries`. A failing config or no entries shows on the home page.
- Every scope and folder gets its own `.pcbjs/dev.json` when the session starts or attaches it, its `url` the scope's page, see session.md. Before a scope loads, the editor's file icons match `pcb.tsx` and `<board>.pcb.tsx`.

## Routes

The slug is the config directory relative to its workspace folder, segments kept to letters, digits, `.`, `-`, `_` and joined by dashes: `examples/demo` is `examples-demo`. The folder itself takes its name; a clash gets `-2`, a viewer route name such as `board` gets `-project`.

| Path | Page |
| --- | --- |
| `/` | every scope: loaded with boards and status, unloaded by name, stale marked |
| `/<scope>/` | the scope's home, or its board when it has one entry |
| `/<scope>/board/<name>` | a board |
| `/<scope>/board/<name>/<slug>` | one target of a board with variants |
| `GET /__pcbjs/scopes` | `{ scopes, displayed, single }` |
| `GET /__pcbjs/scope/<slug>` | makes it the scope shown last, answers with its boards |

A single scope keeps the routes of one project, `/` and `/board/<name>`. The board files under `/__pcbjs/<name>/` are those of the scope whose page asks.

## Scopes at once

- Each loaded scope runs apart, with its own worker thread, defaults, KiCad libraries, model fetch and compiles, session.md: two scopes compile at once, and a query on one never waits for another.
- A viewer names its scope in `observe` and gets that scope's events alone. The scope the editor focused or a page opened last is `displayed` in the scopes list: an editor pane with no scope of its own shows it, and editors and language clients observe it in full.
- Board names may repeat across scopes: assist picks, completion focus, hovered grids and viewer hover stay with the project that supplied them, including a shared library used by several projects.
- A registered workspace-root editor follows the scope shown last for sidebar actions. An unknown project or a viewer's removed scope is refused instead of choosing another project.
- An edit reaches every loaded scope whose module graph holds the file, a shared `lib/` or a `reference()` board included. A scope no one observes goes stale and compiles when a view, a focus or a query asks; a config edit reloads it.
- Source ranges of a shared file are relative to the scope shown last, `../lib/wire.ts`, see ide-bridge.md.
- An editor focus on a file in another scope makes it the one shown last, then follows the focus rules of vscode.md; a file in no scope changes nothing. An IDE mode viewer loads the new scope's page.

## Defaults and state

- `defineDefaultBoard` is kept in each scope's realm, its parts, defaults, KiCad config and model resolver, which the scope's config load and compiles run in.
- Stage outputs, route memos and the type check cache stay in each project's `.pcbjs`. Vite's cache is in the first scope's `.pcbjs/cache/vite`. A project's `vite` options do not apply to the shared server.
- The dev model endpoint serves meshes used by any loaded project's boards or isolated preview, with each project's own model cache.
