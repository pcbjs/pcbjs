---
'@pcbjs/core': patch
'@pcbjs/lib': patch
'@pcbjs/ui': patch
---

A generated model carries its own dimensions: `{ kind: 'chip', part, body: [l, w], cap, height, marking? }` for chip passives, `{ kind: 'led', body, height, cap, color?, lens? }` for chip LEDs and `{ kind: 'led', body, height, window, lead, color? }` for PLCC-4 LEDs such as `WS2812B`. `makeFootprint` fills a `chip` or `led` model's `body` and `height` from the definition's, and `chip()` and `PinHeader` are `makeFootprint` definitions like every other stdlib family, so `withPins` renames their pins too. `GENERATED_KINDS` and `isGenerated` in `@pcbjs/core/internal/model-source` list the generated kinds the `ModelSpec` union is built from.
