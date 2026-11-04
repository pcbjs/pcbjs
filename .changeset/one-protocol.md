---
'@pcbjs/core': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
'@pcbjs/lsp': patch
---

The session and IDE protocol is declared once in `@pcbjs/core/protocol`: the version and `compat()`, every `session/*` method with its params, result and whether it writes, every event the session and its clients send, the posted messages of the viewer page, and the language server's pcbjs methods and segment types. The session, the viewer, the language server and the VS Code extension import it, so a method the session does not answer or an event field one side misreads fails the type check. The language server lists `pcbjs/flush` among its methods, a hello of another protocol major gets the warning whichever side is newer, and the viewer's banner tells a newer session from an older one.
