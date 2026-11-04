---
"@pcbjs/cli": patch
---

Register compiled dependencies before announcing completion and preserve their compiled input stamps, so catch-up detects edits made as a preview finishes updating. Heartbeats recover missed file-watch events for idle projects with connected viewers, reloading the project when its configuration changes.
