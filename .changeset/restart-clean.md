---
'@pcbjs/cli': patch
'@pcbjs/vscode': patch
'@pcbjs/ui': patch
---

`pcbjs cache clear [folder...]` deletes `.pcbjs/cache` and `.pcbjs/typecheck.json` of every project under the folders, and `.pcbjs/models` with `--models`; it refuses while a live session serves one, unless `--force`. The extension's `pcbjs: Restart server and clear caches`, cmd or ctrl+shift+R while a preview tab is active, ends the session, runs it over every folder the session served, starts the session again and reloads the panes. The key map lists the new editor key. After `Restart server` or `Restart server and clear caches` every preview pane shows a restarting page while the session is down, then its own view and board on the new session, on a new port or the same one, instead of staying blank until the window reloads.
