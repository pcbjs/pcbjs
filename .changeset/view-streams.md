---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
'@pcbjs/viewer': patch
---

The dev viewer gets the board in seven facets, `meta`, `sch`, `layers`, `shapes`, `model`, `findings` and `fab`, each sent as `pcbjs:facet` with its run and hash as the stage that makes it ends, all at once on a warm start. An edit sends `pcbjs:invalidate` first and the viewer draws what it makes stale half-opaque until a newer facet remakes it; `pcbjs:status` streams each stage's state, time and units, shown as a bar of one segment per stage. A viewer declares what it shows and an edit compiles only the stages that needs, none without a viewer or editor. A viewer that falls out of sync resyncs, the session writes `.pcbjs/log/<date>-desync.json`, and `pcbjs doctor --desync` prints the last incident. `@pcbjs/core/site-facets` splits and joins the facets and `compileStages` takes a `stage` callback. A referenced board served from its own cache hashes every file its compile read, as a fresh compile does.
