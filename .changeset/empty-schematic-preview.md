---
"@pcbjs/compile": patch
"@pcbjs/ui": patch
---

Keep empty schematic page bounds finite and show a ready empty state for placement-only drafts instead of crashing or leaving the preview loading. Reject invalid cached drawing bounds and recover from invalid saved schematic camera positions.
