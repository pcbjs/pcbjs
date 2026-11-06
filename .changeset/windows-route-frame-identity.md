---
'@pcbjs/core': patch
---

Compare Windows source-frame paths by file identity when attributing route helper callers. Keep generated JSX capture frames from becoming false source locations while preserving real helper call sites and POSIX path case.
