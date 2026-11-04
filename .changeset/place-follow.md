---
'@pcbjs/core': patch
'@pcbjs/compile': patch
---

Followers: `at:follow={{ route, near, side, distance }}` places a part beside the routed copper of a route after the first routing, then routes the legs that end on it; a follower whose pad ends its own route is `follow-cycle`, a followed route with no copper the warning `follow-unrouted`.
