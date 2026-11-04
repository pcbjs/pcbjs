---
'@pcbjs/vscode': patch
---

Fix restored previews getting stuck on the session attachment screen after a window reload. Commit viewer state only once its HTML loads, retry pending loads when their scope changes, and attach panels restored after the initial resume.
