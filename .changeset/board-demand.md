---
'@pcbjs/cli': patch
---

Each board of a session compiles for its own viewers: a schematic pane on one board and a 2D pane on another no longer make both boards compile both views. The editor's focus is worked out once per board shown, and an invalidate goes only to the viewers of its board.
