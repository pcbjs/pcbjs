---
'@pcbjs/ui': patch
'@pcbjs/core': patch
---

Correct movement and control-point modifier help: Shift disables snapping and Cmd/Ctrl constrains an axis; the rotation ring retains Shift for finer stops and Cmd/Ctrl for free rotation. Document operation boundaries and acceptance traceability.

Preserve optional board/target identity on host actions. Explicit first-target actions switch models before applying selection; unknown targets are refused.

Name the affected selection members in the tools toolbar and accessible labels. Match multi-placement rotation previews to the source edit midpoint while retaining the single-placement origin.
