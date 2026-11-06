---
"@pcbjs/cli": patch
---

Prepare a cached interactive board's source evaluation graph before reporting editable readiness, so the first edit does not load a cold source lane. Preserve ordinary CLI cache-only checks and surface preparation failures; add opt-in queue and cancellation timing for sketch diagnostics.
