---
'@pcbjs/compile': patch
'@pcbjs/cli': patch
---

Converted meshes, referenced boards' meshes, fetched models and `pcbjs model add` downloads live once per user in `~/Library/Caches/pcbjs`, `$XDG_CACHE_HOME/pcbjs` or `~/.cache/pcbjs`, or `%LOCALAPPDATA%/pcbjs`, or `PCBJS_CACHE_DIR`, and each project's `.pcbjs/models` links or copies onto them. `pcbjs model cache ls|prune|path` manages the cache and `pcbjs doctor` shows it; a cache that cannot be written leaves the project cache alone with one line saying so.
