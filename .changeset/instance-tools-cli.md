---
'@pcbjs/cli': patch
---

The move, rotate and side tools on an instance write the `at` and `side` of its layout element, `<LedChannelRow g={CH1} at="2 5 90" side="B" />`, and move on a text writes the `at` of its `<text>`. An instance whose layout element places several, one per instance of a layout around it, is not written; the toolbar says so.
