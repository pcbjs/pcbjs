---
"@pcbjs/cli": patch
---

`pcbjs shot` exits as soon as its files are written. It no longer waits minutes for Chrome's crash handler and updater, which keep Chrome's stderr open after Chrome quits, nor 3 s for a stale timer.
