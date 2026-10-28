# Workspace dev server

`pcbjs dev --workspace <folder>...`: one dev server for every project under some folders, each loaded on first use, with its own routes, defaults and HMR.
Read it to serve a monorepo or several projects at once; the VS Code extension runs this server for the whole workspace, see editor.md.

```sh
pcbjs dev --workspace <folder> [<folder>...] [-p <port>] [--host [host]] [--open] [--ide <url>] [--verbose]
pcbjs dev --workspace          # the working directory
```

Each project uses its own config, so `--config` does not apply; other flags are those of `pcbjs dev`. `build` and `check` stay per project.

## Scopes

- A scope is a directory with a `pcb.config.*` or old `pcbjs.config.*`, outside `node_modules` and hidden folders. Start only lists directories and prints each scope's route.
- A scope loads when a viewer opens its page or the editor focuses a file in it: its config through Vite, then its `entries`. A failing config or no entries shows on the home page.
- Each loaded scope writes its own `.pcbjs/dev.json` with `route`, `scope` and `url`. Before it loads, the editor's file icons match `pcb.tsx` and `<board>.pcb.tsx`.

## Routes

The slug is the config directory relative to its workspace folder, segments kept to letters, digits, `.`, `-`, `_` and joined by dashes: `examples/demo` is `examples-demo`. The folder itself takes its name; a clash gets `-2`, a viewer route name such as `board` gets `-project`.

| Path | Page |
| --- | --- |
| `/` | every scope: loaded with boards and status, unloaded by name, stale marked |
| `/<scope>/` | the scope's home, or its board when it has one entry |
| `/<scope>/board/<name>` | a board |
| `/<scope>/board/<name>/<slug>` | one target of a board with variants |
| `GET /__pcbjs/scopes` | `{ scopes, displayed, single }` |
| `GET /__pcbjs/scope/<slug>` | shows that scope, answers with its boards |

A single scope keeps the routes of one project, `/` and `/board/<name>`. The board files under `/__pcbjs/<name>/` are those of the displayed scope.

## The displayed scope

- One scope is displayed, the last opened or focused; HMR follows it alone. Its module graph and config stay watched after it hides.
- An edit in a hidden scope's graph, a shared `lib/` or a `reference()` board included, marks it stale; it recompiles when displayed. A config edit reloads the scope.
- Source ranges of a shared file are relative to the displayed scope, `../lib/wire.ts`, see ide-bridge.md.
- An editor focus on a file in another scope switches the displayed scope, then follows the focus rules of editor.md; a file in no scope changes nothing. An IDE mode viewer loads the new scope's page.

## Defaults and state

- `defineDefaultBoard` and `defineDefaultRules` are kept per scope from its config and installed only around its compiles.
- Route caches, locks and the type check cache stay in each project's `.pcbjs`. Vite's cache is in the first scope's `.pcbjs/cache`. A project's `vite` options do not apply to the shared server.
