---
'@pcbjs/cli': patch
---

The session takes agents: `session/describe` records an agent's task, plan and progress, shown in `session/clients` and in `by.task` of its events, and posts them to the editor as a `message` event; `session/send` queues a message from the editor to one agent connection, delivered as `session/message` and acknowledged with `session/ack` or `session/inbox`, a `delivered` event either way, `returned` when the agent left unread; `session/read`, `session/write` with edits anchored on text through `applyEdits()`, and `session/findings` with a scope. A claim from a harness hook names the agent by its harness name, and an unclaimed write waits for its claim past a compile once a hook said it claims.
