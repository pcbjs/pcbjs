---
'@pcbjs/core': patch
'@pcbjs/cli': patch
---

The session reads and writes every source through one service: it decides whether a file's true text is an editor's buffer, a restored buffer or the disk, and every write goes through it. A tool edit, an undo or an agent's `session/write` to a file whose editor reopened a restored backup is made on the disk text and replaces that buffer at the version it opened, instead of landing in the stale buffer. `session/read` answers `{ file, text, authority, version }`, `authority` being `editor`, `restored` or `disk`, and an agent's new file goes through the editor when one is attached.
