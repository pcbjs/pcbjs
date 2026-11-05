---
"@pcbjs/cli": patch
"@pcbjs/compile": patch
"@pcbjs/ui": patch
---

Show compile failures with author source locations, draft-aware code excerpts and useful author call sites instead of pcbjs implementation stacks. Preserve source ranges across the compile worker, keep internal traces behind explicit CLI debugging, and explain differential-pair endpoint net mismatches with actionable context.
