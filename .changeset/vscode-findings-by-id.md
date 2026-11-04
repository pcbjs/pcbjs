---
'@pcbjs/vscode': patch
---

The Findings tree keys each finding by its exact id, lists its refs under it, and keeps a selected or open finding across a recompile that renumbers it, by fingerprint and nearest position. A click posts `pcbjs:finding` with the id, a ref row selects it in the viewer, and the shown board lists its parts by reference, an instance's as `CH2/R01`. The tree reads a finding's `src` as source ranges.
