---
'@pcbjs/compile': patch
'@pcbjs/core': patch
---

The stage cache: `compileStages` keys every stage on the facets of the board it reads and stores its output in `.pcbjs/cache`, `index/<board>[~<slug>].json` and content-addressed `objects/<hh>/<sha1>.json.gz`, so an edit reruns only the stages it reaches and a comment stops at `place`. Route memos live in `.pcbjs/cache/route/<board>.json`; `CompileOptions.cache` names the cache, and `servedStages` gives back every board of an entry whose files are unchanged without evaluating. `RouteRequest` takes an optional `topology` and `class`, left out of a leg's key when absent.
