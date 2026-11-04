---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/ui': patch
'@pcbjs/cli': patch
---

A finding has one shape everywhere, `Finding` of `@pcbjs/core/finding`: the site's `drc` and `erc` rows are findings as `check --json` reports them, with `path`, and each carries a `mark`, where the views and `pcbjs shot` draw it, a dot on a layer, a line with its ratsnest index, or nowhere, computed once by the export. `pcbjs shot` draws an `unconnected` or `route-failed` finding on its line instead of ringing it. A finding names the net and the route it concerns in `refs`, `route:3` included, which stays out of the fingerprint; a failed leg's ends are its witness segment and its layers in `args`.
