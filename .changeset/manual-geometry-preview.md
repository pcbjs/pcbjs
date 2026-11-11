---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
---

Stream explicit placements and resolvable manual copper before solver work, then replace them with the completed geometry in the same run. Keep checks and fabrication results pending until they match the current geometry.

Build explicit geometry through tracked immutable products, and validate reusable routing searches against their original inputs, including rejected paths and empty space. Keep coupled solver work coherent and report dependency cycles along their actual edges.

Reject late results from superseded edits and suppress final preview updates from cancelled multi-board builds while preserving worker response decoding.
