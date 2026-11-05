---
'@pcbjs/cli': patch
'@pcbjs/skills': patch
---

Verify MCP session attachment before completing initialization and reconnect persistent agents after server restarts even without resource subscriptions. Restore task context, cancel reconnects on transport closure, and avoid restarting stopped servers in the background.

Distinguish configured integrations from live agent inboxes in setup output, skills and guidance. Require message-consumption checkpoints and give Codex registrations time to complete the session handshake.
