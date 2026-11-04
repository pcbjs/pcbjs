---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/kicad': patch
'@pcbjs/export': patch
'@pcbjs/step': patch
---

The platform: everything the compiler reaches outside JavaScript, file reads and listings, sha1, paths, the environment and the disk of the stage cache and route memos, goes through one `Platform` of `@pcbjs/core/platform` on `globalThis`, Node's by default and unchanged in what it does. `memoryPlatform` serves files from memory with a JavaScript SHA-1, POSIX paths and no store. The stage cache, route memos, model paths and `model-missing`, outline fonts, `reference()`, model anchoring, KiCad library reads and STEP mesh keys all use it; `@pcbjs/kicad` and the STEP mesh key import no `node:` module, and opentype.js loads under a bundler too.
