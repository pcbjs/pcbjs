---
'@pcbjs/compile': patch
---

Edit nodes carry the `frames` of the instances and named groups around them, outermost first, so isolation draws each definition in its own frame; a part with its own placement carries `owned`, its instance.
