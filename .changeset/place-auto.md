---
'@pcbjs/core': patch
'@pcbjs/compile': patch
---

Auto placement: a slot of a part's `at` written `auto` is placed by a seeded search over the ratsnest half-perimeter with courtyard, outline and keepout penalties, members of a group drawn together; `at:initial` seeds it, `at:cost` adds to it, `at:solver` places a part ahead of it, `<PCB place={{ seed }}>` picks the search, and `board.placed` records each placement. See placement.md.
