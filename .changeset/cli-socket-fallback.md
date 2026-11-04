---
'@pcbjs/cli': patch
---

A session whose project path and `$XDG_RUNTIME_DIR` socket path are both past the socket limit binds in `<tmpdir>/pcbjs-<uid>` instead of failing with `listen EINVAL`.
