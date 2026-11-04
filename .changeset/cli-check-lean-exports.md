---
'@pcbjs/cli': patch
---

`pcbjs check` and the compile of a referenced board build only the fab set and the site data in the exports stage, no GLB, board SVG or schematic SVG, which brings their cold time back to what it was before the GLB export: about 0.6 s less on demo, 0.9 s on led-matrix and stm32-dev, 0.5 s on controller and 0.8 s on its referenced driver.
