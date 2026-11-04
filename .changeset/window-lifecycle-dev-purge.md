---
"@pcbjs/vscode": patch
---

Make window teardown bounded and repeatable, cancel pending connections and scope waits, and prevent disposed window connections from restarting. Add a development-only Purge Reload Dev Suite command that saves edits, stops checkout sessions, clean-builds core/UI, clears generated caches, reinstalls the local extension and reloads after successful installation.
