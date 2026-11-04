---
'@pcbjs/viewer': patch
'@pcbjs/cli': patch
---

The 2D view puts the active side on top: front and back buttons choose the side drawn over the inner layers and the far side, without mirroring, and a Mirror button, off by default, mirrors the view to read the back as seen from behind. The URL carries `side=F|B` and `mirror=1|0`, and `pcbjs:view` messages carry `side` and `mirror`. `pcbjs shot` takes `--side F|B` and `--mirror`, naming its files `-back` and `-mirror`.
