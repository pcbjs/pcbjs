---
'@pcbjs/core': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
---

Each project of a session runs on its own: its compile thread, its scheduler of the edit tiers and its snapshots. Two projects of a workspace compile at once, and a query on one no longer waits for another project's compile. The keystroke tier, the compile after the quiet period and a query's compile are one scheduler with the tiers as data, and the editor's drafts keep only their repair and hold. A viewer names its scope in `observe` and gets the events of that scope alone, so two tabs on two projects no longer switch the session between them; `displayed` in the scopes list is the scope the editor focused or a page opened last, which an editor pane with no scope of its own shows. A board file under `/__pcbjs/<name>/` and `/__pcbjs/open` resolve against the scope of the page that asks.
