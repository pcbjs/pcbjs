---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
---

Finding messages, compile errors, `inspect --references` and the reference anchors name a pad as references do, `pad R1/2`. The site data's markers carry a finding's `id`, `fingerprint`, `refs` and `src` as `check --json` has them, `src` a list of source ranges with roles, and each source range lists the `uids` of its items beside their ids.
