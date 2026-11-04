---
'@pcbjs/vscode': patch
---

A click on a board in the Boards view opens its entry with the cursor on its `<PCB` and the editor focused, beside switching the panes. A click on a project folder only expands it and lists its boards, its config's entries until it loads, and never switches the panes, unless the folder declares one board, which it then shows and opens as a board click does.
