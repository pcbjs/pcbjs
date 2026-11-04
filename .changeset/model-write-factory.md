---
'@pcbjs/cli': patch
---

model add --write puts the model in the options after the value of a factory call, `PinHeader(4)('x', { model })`.
