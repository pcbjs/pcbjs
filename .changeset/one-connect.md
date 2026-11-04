---
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
---

A page takes every event in one place, `connect(shell, transport)` of `@pcbjs/ui`: the session's boards, facets, invalidates, heartbeat, status, focus, selection and hover relay, editor context, edit channel and agents, the browser's history, links and keys, and what a frame posts to the page around it. The session comes through a `Transport`, the session's socket by `sessionSocket`; `connectBoard(board, transport)` takes one board's facets, invalidates and heartbeat the same way.
