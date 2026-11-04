---
'@pcbjs/cli': patch
'@pcbjs/core': patch
'@pcbjs/vscode': patch
---

`pcbjs dev` starts one session per repository, detached, or attaches to the live one, follows its log and prints its URL; Ctrl-C detaches, a second Ctrl-C within 2 s stops it, and the session ends after 600 s without clients, `--grace <s>` to change it. `pcbjs session serve` runs it in the foreground, `session stop` ends it and `session status` describes it. The session listens on `.pcbjs/session`, a UNIX socket of mode 0600, or a named pipe on Windows, and on `/__pcbjs/session`, newline-delimited JSON or one frame per WebSocket message; hello carries `role`, `project` and `token`, ready `session`, `mode` and `projects`. `--edit localhost|all|none`, or `session: { edit }` in pcb.config.ts, decides who may edit; LAN clients need the token printed by `pcbjs dev`. `dev.json` holds `session`, `socket`, `edit` and `token`, and is written in every project at start with mode 0600. Worktrees of one repository share the session. The extension shows `attaching`, `<n> boards`, `reconnecting` or `failed` in the status bar; editor events and the language server travel on the session's socket.
