---
'@pcbjs/compile': patch
'@pcbjs/cli': patch
---

Fetched models and `model add` downloads sit in the user model cache under their content hash, the index naming the content each source gave last, so a new download never replaces a file another project links. `model add` of a URL asks the server again with its ETag or Last-Modified and downloads a changed file instead of serving the cached one.
