---
'@pcbjs/core': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
'@pcbjs/viewer': patch
---

Every compile of a session is a numbered run, and a snapshot is the run that committed it, `<session>.<run>`. Facets, invalidates, the compile status, the heartbeat, the boards a page loads and an edit's begin carry `run`. A facet module's header carries `run` and a content `hash`, a `?pcb:board` ref carries `run`, and events log ids and cursors take the form `<session>:<seq>`, so a cursor is never mistaken for a snapshot, and a cursor of another form gets a reset.
