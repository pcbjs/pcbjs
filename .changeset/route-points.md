---
'@pcbjs/core': patch
'@pcbjs/compile': patch
'@pcbjs/cli': patch
---

A bound route has route points, `.start`, `.end` and `.pt(k)`, typed route ends and `at:follow` anchors resolved once that route is laid. A route a circuit build binds and returns is a member of each instance, `ch2.vccTrunk`, placed by its layout as `{g.vccTrunk}`, so `route(J1[2], ch2.vccTrunk.end)` routes to that instance's trunk. The reference grammar names it `CH2/route:vccTrunk` and its points `CH2/route:vccTrunk/pt:2`, which `inspect` and `q` answer.
