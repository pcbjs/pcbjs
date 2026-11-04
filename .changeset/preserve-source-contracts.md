---
"@pcbjs/core": patch
"@pcbjs/compile": patch
"@pcbjs/export": patch
"@pcbjs/cli": patch
"@pcbjs/ui": patch
"@pcbjs/vscode": patch
---

Preserve recovered editor buffers and respect editor write refusal. Reject multi-document preview gestures before applying changes, validate canonical selections and compatible session handshakes, and cancel superseded source navigation. Add explicit plugin configuration cache keys with a safe uncached default, geometry/item coherence checks, and negotiated library-preview support.

Refresh the browser self-check baselines for the current compiler output; deterministic comparison remains enforced.
