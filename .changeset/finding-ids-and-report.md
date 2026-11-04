---
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
---

Finding identity, evidence and the check report. Findings get an exact id `drc:<rule>:<12 hex>`, a fingerprint that survives unrelated edits, refs in the reference grammar, `measured`, `required`, `witness`, `provenance` naming the rule level a value came from, `src` as source ranges with roles, and a message from one template per rule; `check --watch` and the session match findings by fingerprint, then nearest position. `check --json` and `build --json` write the `pcbjs.check/1` report once, after the typecheck: result, exit, versions, per-board snapshot, stages and findings, diagnostics for compile, type, config, reference, cycle and plugin errors, typecheck and cache; `check --watch` typechecks again after each recompile and rewrites it. Finding lines end with their id. `pcbjs inspect` takes any reference, `R1/2`, `net:VCC`, `route:3/pt:2`, `item:…`, `drc:…`, prints uids, and `--lengths` lists routes in PCB tree order.
