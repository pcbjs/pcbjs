---
'@pcbjs/compile': patch
'@pcbjs/export': patch
'@pcbjs/cli': patch
'@pcbjs/ui': patch
'@pcbjs/lsp': patch
---

Typing feels instant. An edit cancels the running compile at once: the stages read the cancel per module, element, leg, negotiation round, zone, rule and format, so a cancelled compile stops within a few milliseconds, sends nothing more and says `cancelled` in `pcbjs:status`. Typing runs in two tiers: 30 ms after a keystroke the session draws the edited entity alone, a text block's outline, a part's land pattern or a trace's copper, from the text as typed, over the rest of the board half-opaque, without the type check or the stage cache; once no key came for 300 ms the full compile runs with the hold's type check. The two delays are in `dev.json` and `session/state` as `tiers`, set by `PCBJS_KEYSTROKE_MS` and `PCBJS_QUIET_MS`. Every `pcbjs:invalidate` carries `edit`, and the viewer never applies a facet of a compile that edit made stale. The language server publishes a change's diagnostics and its cursor highlight after the quiet period, so the type checker never holds up a keystroke.
