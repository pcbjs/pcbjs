---
'@pcbjs/cli': patch
'@pcbjs/skills': patch
---

`inspect <ref> --json` answers a part as `{ frame, part }` and adds the net answer under `net` when the ref also names a net, one shape either way. `inspect --references` prints the side a stacked reference lies on, F or B, or `coplanar`, beside its mate, and `--json` carries `side` and `stack` as the reference options name them.
