# Workspace dev server

`pcbjs dev --workspace <folder>...`: one dev server for every project under some folders, each loaded on first use, with its own routes, defaults and HMR.
Read it to serve a monorepo or several projects at once; the VS Code extension runs this server for the whole workspace, see editor.md.

## Synopsis

```sh
pcbjs dev --workspace <folder> [<folder>...] [-p <port>] [--host [host]] [--open] [--ide <url>] [--verbose]
```

The folders follow `--workspace`, as its value and as the arguments after it; `pcbjs dev --workspace` alone serves the working directory. `--config` does not apply: each project uses its own config. The other flags are those of `pcbjs dev` in cli.md.

## Scopes

At start the server lists the scopes: every directory with a `pcb.config.*`, or an old `pcbjs.config.*`, under the folders, outside `node_modules` and hidden directories. It reads directory listings only and loads nothing else. The terminal prints one line per scope with its route and directory.

A scope loads on first use: when a viewer opens one of its pages, or when the editor focuses a file inside it. Loading imports its config through Vite and reads its `entries`; a scope whose config fails, or lists no entries, shows its error on the home page. Each loaded scope writes its own `.pcbjs/dev.json`, with `route`, `scope` and `url` added, see ide-bridge.md.

Entries come only from `entries`; the recommended names, `pcb.tsx` for a single board and `<board>.pcb.tsx` for each of several, are what the editor's file icons match before a scope loads.

`build` and `check` stay per project: run them in the project directory.

## Routes

The scope slug is the config directory relative to its workspace folder, each path segment kept to letters, digits, dot, dash and underscore and joined by dashes: `examples/demo` becomes `examples-demo`. The folder itself takes the folder's name. A clash gets `-2`, and a slug that is a viewer route name, such as `board`, gets `-project`.

| Path | Page |
| --- | --- |
| `/` | the workspace home: every scope, loaded ones with their boards and status, unloaded ones by name, stale ones marked |
| `/<scope>/` | the scope's own home page, or its board when it has one entry |
| `/<scope>/board/<name>` | a board of the scope |
| `/<scope>/board/<name>/<slug>` | one target of a board with variants |

A workspace with a single scope keeps the routes of one project: `/` and `/board/<name>`.

`GET /__pcbjs/scopes` answers with `{ scopes, displayed, single }`, and `GET /__pcbjs/scope/<slug>` shows that scope and answers with its boards. The board files under `/__pcbjs/<name>/` are those of the displayed scope.

## The displayed scope

One scope is displayed at a time: the last one a viewer opened or the editor focused. HMR follows it alone. After a scope compiles, every file of its module graph and its config are added to Vite's watcher, wherever they live, and stay watched while it is hidden. The watcher sets the stale flag itself: an edit of a file in the graph of a loaded scope that is not displayed marks that scope stale, shown on the home page, and it recompiles the next time it is displayed. An edit of a loaded scope's config loads it again.

Files shared between scopes count too, such as a `lib/` beside the scope folders that is no scope itself. An edit there recompiles the displayed scope when its graph holds the file and marks every other loaded scope whose graph holds it stale. A shared file no compiled scope imports changes nothing. The files of a board a scope references with `reference()` count as its graph too, so an edit of the referenced board marks the referencing scope stale, see references.md. Source ranges of a shared file are named relative to the displayed scope, `../lib/wire.ts`, see ide-bridge.md.

An editor focus on a file inside another scope switches the displayed scope, then follows the focus rules of editor.md within it; a file in no scope changes nothing. A viewer in IDE mode loads the new scope's page.

## Defaults

`defineDefaultBoard` and `defineDefaultRules` write one registry per process. Loading a scope empties it, imports the config and keeps what the config declared as that scope's defaults. Each compile of the scope installs them and removes them after, keeping what the entries' own modules declared, so two projects with different defaults never see each other's.

## Per scope state

Route caches, locks and the type check cache stay in each project's own `.pcbjs`. Vite's cache is in the first scope's `.pcbjs/cache`. A project's `vite` options do not apply to the shared server.
