---
"@pcbjs/cli": patch
"@pcbjs/ui": patch
---

Read placement lock state from coherent current view geometry without upgrading a view-only compile to a full check. Return pending for changed or unavailable geometry and retry when its facets settle, while preserving full edit transaction guards.
