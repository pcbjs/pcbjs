---
'@pcbjs/cli': patch
'@pcbjs/compile': patch
'@pcbjs/ts-plugin': patch
'@pcbjs/core': patch
'@pcbjs/skills': patch
---

Every CLI flag has one form. `shot --side F|B` picks the side on top and `shot --view` repeats, 2D and 3D by default; `shot --fresh` compiles here even when a session is live. `dev --workspace` is a switch and its arguments are the folders. `inspect --references` and `inspect --sch` print those reports, and a pad is `REF/PAD`, inside an instance `CH2/R/1`. `model add` and `model align` name the board with `--entry`. `create` writes the one board template. The config file is `pcb.config.{ts,mts,js,mjs}`.
