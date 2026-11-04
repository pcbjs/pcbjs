---
'@pcbjs/vscode': patch
'@pcbjs/cli': patch
---

The extension's Fabrication dialog: a panel from the status bar and `pcbjs: Fabrication` with one card per board and target, ORDERABLE, BLOCKED or STALE, the zip with its rev, size, sha256 and date source, Build, Reveal zip, Open folder and Copy sha, and every blocker with one action: open the finding, save, open source control, add rev, build. `session/check` takes `report: true` and answers with the `pcbjs.check/1` report and each board's fab set paths, rev and module graph.
