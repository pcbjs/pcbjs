---
'@pcbjs/core': patch
'@pcbjs/cli': patch
'@pcbjs/lsp': patch
---

A session reports each compile once, as a stream of compile events declared in `@pcbjs/core/protocol` as `CompileEvent`: requested, started, stage, facet, failed, cancelled, committed and held. The viewer status, the heartbeats, the events log, the language servers and the dev log all follow that stream. The events log's `compile` kind now says when a run starts and when an edit cancels it, so `pcbjs events --wait --for compile` returns as a compile begins. `session/state` is the one heartbeat, on one timer, with `pending` and `tiers`. The language servers refresh their findings only once a compile minted a snapshot, and only for that project, rather than after every compile of any project, cancelled ones included.
