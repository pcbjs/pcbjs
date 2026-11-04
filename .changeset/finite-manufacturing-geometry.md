---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/export': patch
---

Reject nonfinite geometry including unit conversion overflow before compilation and manufacturing export, and require positive pad and drill dimensions. Strengthen Gerber self checks to reject truncated structure, unclosed regions and extra open profile toolpaths while retaining valid empty layers.
