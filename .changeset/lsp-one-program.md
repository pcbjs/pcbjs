---
'@pcbjs/lsp': patch
'@pcbjs/cli': patch
---

A session holds one TypeScript program over its open documents for every editor and agent connection, about 110 MB on a large board instead of that much per connection. A connection whose text the session does not compile, a reader or an agent refused by the editor's hold, gets a program of its own while its text differs and drops it when the texts agree again or it closes. The compile hold's type check and the ref style hints are computed once per change for all connections.
