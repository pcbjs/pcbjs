---
'@pcbjs/compile': patch
'@pcbjs/core': patch
---

Each compile stage is declared once with the facets it reads and writes and the views it ends, and one runner plans, runs and caches them. A plugin's `reads` now key its stages: a `beforeChecks` stage and a check are each cached on the facets they list and the plugin's name and version, so a read left out serves stale output, and a hook makes the stage it hooks key on every facet. The built-in checks are cached one by one, and `finish` as its pours and its silk refs, so a silk label edit keeps the routing, the tuning, the pours and the copper checks and runs only the silk refs, the silk checks and the exports; `tune` keys on the drawings within reach of a tuned route. `Facet` names the facets a compile hashes, `frame`, `edit`, `plugins`, `stats`, `sch`, `rest`, `jobs.finish`, `jobs.sch` and `models` among them. `compileLoaded(load, opts)` takes the entry's evaluation from the caller as the `evaluate` stage. Under `PCBJS_FREEZE=1` a stage that changes a facet its writes leave out throws.
