---
'@pcbjs/compile': patch
---

Fix internal routing failures when same-net trunks on different layers connect with a via and no tracks. Preserve the via-only leg's copper dependencies and cache invalidation so negotiation can reroute it when a supporting trunk moves. Invalidate older router memos, including cached internal failures.

Queue legs displaced by late reroutes, including reroutes of dependent branches, so no leg silently loses its result and changes the board when route memos replay.
