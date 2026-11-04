---
"@pcbjs/compile": patch
"@pcbjs/cli": patch
"@pcbjs/ui": patch
"@pcbjs/vscode": patch
---

Honor plugin configuration and cache policy across startup reuse, including environment-driven activation. Accept footprint isolation, preserve the latest pending library selection, clear target-local focus when changing targets, and recover rejected optimistic selections. Serialize source-navigation host operations and guard delayed layout, tab movement and focus restoration.
