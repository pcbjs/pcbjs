# Session

The process per checkout serving the viewer, compiles and language servers for `pcbjs dev`, editors and agents.
Advanced. Read it for what keeps running after Ctrl-C, how to stop it, and how a client connects; ide-bridge.md has the frames, workspace.md the projects.

```sh
pcbjs dev                      # start or attach, follow its log; Ctrl-C detaches
pcbjs session status           # id, pid, socket, projects, clients; exit 3 without one
pcbjs session stop             # end it
pcbjs session serve -p 5211    # the session in the foreground, for CI and workers
```

## Lifetime

- A starter, `pcbjs dev`, `pcbjs mcp` or `pcbjs lsp --stdio`, spawns `pcbjs session serve` detached and attaches, so closing one never ends it.
- `pcbjs dev` reads `.pcbjs/dev.json`, checks the pid and socket, and attaches; else it takes `.pcbjs/session.lock`, stale after 30 s or with a dead pid, and spawns. Two starters give one session.
- `pcbjs dev` prints the session id and URL and follows its log. Ctrl-C detaches, a second within 2 s stops it.
- `-p`, `--host`, `--edit`, `--grace` and `--ui-src` warn when a session runs.
- Clients are socket, pipe and WebSocket connections and HTTP requests in flight; closing a connection detaches. With none left the idle grace runs, 600 s or `--grace <s>`.
- The session ends on `pcbjs session stop`, SIGTERM, SIGINT or SIGHUP, the grace, or, polled every 2 s, its first folder or its dev.json gone or naming another pid. It sends `pcbjs:ide:bye` `{ reason }` and removes its dev.json files and socket.
- `pcbjs dev` attaches again when its session vanishes without a bye, and exits on one.
- `pcbjs session serve` exits 0 when a live session serves its root. `check`, `inspect`, `shot`, `q`, `script` and `test` never start one: they ask a live one, else compile in process, as `--fresh` does. `events` without a session exits 3.

## Repositories and worktrees

- A session is keyed by the git checkout of its first folder, else the folder, so each worktree has its own, named by `<runtime>/<hash>.json` in `$XDG_RUNTIME_DIR/pcbjs` or `<tmpdir>/pcbjs-<uid>`, mode 0700.
- A starter in the checkout joins through that record. A hello or `session/attach` naming a folder attaches it, with no dev.json in another worktree.
- `session serve` in a root of its own runs apart.
- Each project keeps its caches in its `.pcbjs/`. With two or more projects each is a scope of workspace.md under `/<scope>/`.

## Files

| File | Holds |
| --- | --- |
| `.pcbjs/dev.json` | in every project and folder the session serves, mode 0600, written at start |
| `.pcbjs/session` | the UNIX socket of the session whose first folder this is, mode 0600 |
| `.pcbjs/session.lock` | `{ pid, at }` while a starter spawns |
| `.pcbjs/log/session.log` | the session's output, set aside as `session.log.1` past 1 MB |
| `.pcbjs/log/<date>-desync.json` | a view that fell out of sync, the last 20 kept |

```ts
interface SessionInfo { session: string; pid: number; version: string; protocol: number; major: number; startedAt: string; root: string; url: string; socket: string; edit: 'localhost' | 'all' | 'none'; checkout?: string; token?: string; tiers: { keystroke: number; quiet: number } }
```

`session` is 8 base32 characters per start, `socket` a path or pipe name, `checkout` that of its first folder, `token` only under `edit: 'all'` beyond loopback.

## Listeners

- POSIX: the socket at `<first folder>/.pcbjs/session`, mode 0600 from the bind. A path of 100 bytes or more binds `<runtime>/<hash>.sock`, or `<tmpdir>/pcbjs-<uid>/<hash>.sock` when that is long too, `hash` 16 hex of SHA-256 of the real path; dev.json names it.
- Windows: the named pipe `\\.\pipe\pcbjs-<user>-<hash>`, `hash` over the lowercased real path; its default DACL lets other users read only.
- TCP: a WebSocket at `/__pcbjs/session` on the dev server, one frame per message. A browser page of another origin is refused.
- Frames: newline-delimited JSON on the socket and the pipe, at most 16 MB each, an event `{ event, data }` or JSON-RPC 2.0. A client says `pcbjs:ide:hello`, its `role` one of `editor`, `agent`, `viewer` and `cli`, and gets `pcbjs:ide:ready` with `session`, `mode` `rw` or `ro` and `projects`, ide-bridge.md; `session/*` requests are the session's own, any other JSON-RPC goes to the client's language server.

Each method's params and result are `Methods` of `@pcbjs/core/protocol`, ide-bridge.md; the read-write ones are `WRITE`.

| Method | Answer |
| --- | --- |
| `session/status`, `clients` | dev.json's fields, the folders, projects, log, idle time and connections; each connection with its role, mode, version and task |
| `session/attach`, `detach` | serves folders too, a project as it is, any other folder searched for projects; stops serving attached ones, never the first |
| `session/stop` | ends the session |
| `session/check`, `inspect` | `Envelope<{ stdout, stderr?, exitCode }>` as in process; `report` adds the check report and each board's fab `sets` |
| `session/q`, `resolve` | the record of queries.md; any reference as the current snapshot names it |
| `session/script`, `test` | output or error; the snapshot written for testing.md |
| `session/boards`, `render` | the boards for `shot`; a PNG of render.md, base64, with its legend |
| `session/facets` | an entry's facets for ui.md's `?pcb:` imports |
| `session/events` | `{ events, next, reset? }`; with `follow` each event after as `session/event`, queries.md |
| `session/edited`, `claiming` | claims the write for that harness's agent; says claims will come; queries.md |
| `session/describe`, `send`, `ack`, `inbox` | an agent's task and plan; a message to an agent, its acknowledgement, a harness's waiting ones; mcp.md |
| `session/read`, `write`, `findings` | a file as compiled, its authority and version; edits through `Sources`; the findings |
| `session/select`, `observe`, `resync`, `hover`, `edit/*` | a viewer's selection and view, ide-bridge.md; its tools, editing.md |

- A `session/*` request waits until every language server handled what it had, so a query sees all text sent before it.
- Every frame on a connection carries `seq`, gapless from 1. On one 5 s timer, after each snapshot and as a hold begins or ends, a connection gets `session/state` of its project, `{ project, run, facets, pending, hold, tiers }`: the current snapshot's run, a hash per `<facet>:<board>` or `<facet>:<board>|<target>`, viewer.md, whether a compile runs or waits, the draft holding the compile, editor.md, and `tiers`.

## Documents

- One store holds the open text of every connection's language server, full document sync; disk rules every other file. The compile reads it as drafts, vscode.md, and tsc reads it in `session/check` without touching `.pcbjs/typecheck.json`.
- The editor connection that synced a file last holds it. A connection whose hello says `role: 'agent'` syncs a file only while no editor holds it, else its text stays its own. Save or close by the holder, and its disconnect, hand the file back to disk.
- An open editor buffer is authoritative immediately, including recovered hot-exit text opened at version 1. Compilation and preview edits use that text and its current version. Recovery never silently replaces unrelated unsaved content with disk text.
- A disk write under a file an editor holds stays shadowed until the editor saves, reverts or merges: the editor's text compiles, the event `edit` of queries.md says `{ file, source: 'disk', ranges: null, shadowed: true }`, `source: 'agent'` and `by` when an agent claimed it through `session/edited`, and the editor gets a warning on the file, code `shadowed`. The extension merges three ways, editor.md.
- `Sources` of `session/sources.ts` reads and writes every source: `read(file)` gives `{ text, authority: 'editor' | 'disk', version }`, and `write` goes through the `workspace/applyEdit` of the editor the edits were read from, at that version, else any editor's of the project, and to disk by a rename only with none attached. An editor refusal is final, including file creation; it never falls through to a disk write. Current source authority is `editor` or `disk`. The wire type still accepts `restored` from older compatible servers.

## Snapshots

- Every compile is a run, numbered from 1 across the session; facets and invalidates name it. A finished compile of every view commits its run as the snapshot `<session>.<run>`: boards, findings, the stamps of the files it read and the text it compiled; the current and previous are kept per project.
- Compiled dependencies are registered before completion is announced. Catch-up compares their compiled input stamps, so a later disk edit cannot become the baseline of an older preview. Every 5 s, the heartbeat checks idle projects with connected viewers for missed file-watch events; changed configuration reloads the project, active compiles are left alone, and hidden projects catch up when shown.
- Every query settles first: it rescans files and open text every 50 ms until two scans agree, 1 s at most, compiles what changed and answers within `timeout`, 120 s, else from the last snapshot with `stale: { reason: 'timeout' }`.

```ts
interface Stale { reason: 'changed' | 'compiling' | 'failed' | 'timeout' | 'gone'; current?: string }
interface Envelope<T> { snapshot: string; stale: Stale | null; overlay: string[]; value: T }
```

- A reference gone from the current snapshot resolves by lineage, through its call: `TP2` renamed answers `TPX` with `stale: { reason: 'changed', current: 'TPX' }`, one whose call is gone `reason: 'gone'` with the nearest names. A finding id goes by fingerprint first.
- An edit cancels the running compile within a few ms, design.md, keeping its finished stages, and says only `pcbjs:status` `cancelled`. A compile thread that exits is restarted once; a second exit in a row fails its compiles, never the session.

## Modes

`--edit localhost|all|none` on `dev` and `session serve`, else `session: { edit }` in pcb.config.ts, else `localhost`.

| Mode | Read-write | Read-only |
| --- | --- | --- |
| `localhost` | the socket, the pipe, loopback HTTP and WebSocket | the LAN |
| `all` | the above, and LAN clients with the session token | LAN clients without it |
| `none` | nobody; `session/stop`, `attach` and `detach` still work on socket and pipe | everybody |

- The token is 128 random bits per start, only with `--edit all` and a `--host` beyond loopback. `pcbjs dev` prints the LAN URL with `?token=`, dev.json holds it, the config never does; a client sends it as `?token=` or in its hello.
- Read-only connections may run checks, queries, docs and plain renders. `script`, `write`, `send`, `edited`, `claiming`, scripted renders, `test` and document sync need read-write.

## Agents

- An agent, `role: 'agent'`, states its task and plan with `session/describe` before its first edit, listed by `session/clients`, logged as a `message` to `editor`; the editor's messages reach it through `session/send`, mcp.md.

## Stopping a session

`pcbjs session stop` in the project, Ctrl-C twice in `pcbjs dev`, once in `session serve`, or `kill` on its pid.

## Views

- Each project has its own compile thread, scheduler, snapshots and facets, so projects compile at once. A compile is one stream of `CompileEvent`, `@pcbjs/core/protocol`: the status, the heartbeats, the events log, the language servers and the dev log follow it.
- Demand: a viewer declares `session/observe { board, target, scope, facets }`, and each board compiles the stages its own viewers need: `meta`, `model` and `sch` no copper, `layers` and `findings` through checks, `fab` everything. The status goes to its project's viewers, an invalidate to its board's, a facet to those naming its board, target and facet, `fab` always and every `meta` to all; one that never observed gets none. A changed `observe` sends what it lacks, by its hashes. Editors, language clients, followers, queries and one-shot runs want everything. A compile of some views mints no snapshot; a board no one observes compiles once one asks.
- The tiers are data, `tiers: { keystroke: 30, quiet: 300 }` ms in dev.json and the heartbeat, set by `PCBJS_KEYSTROKE_MS`, `PCBJS_QUIET_MS`: Syntax preparation starts immediately for observed edits and is reused by the keystroke tier. `keystroke` ms after a key, `pcbjs:invalidate` of what the edit makes stale and a `layers` facet of the edited entity alone, never cached or type checked; `quiet` ms after the last key, 60 after a disk write, the compile of what is observed unless a block holds, editor.md; a query, every view at once. No facet of a run up to an invalidate's `edit` reaches a viewer, viewer.md.
- A viewer out of sync asks for its facets again and the session writes `.pcbjs/log/<date>-desync.json`, ids, hashes and recent frames, never file content. `pcbjs doctor` counts them, `--desync` prints the last.
