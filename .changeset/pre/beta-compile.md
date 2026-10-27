---
"@pcbjs/compile": patch
---

First beta. Compiles a board into one model: placement, manual and automatic routing with negotiation, differential pairs and length tuning, pours and stitching, silk reference placement, connectivity, and DRC and ERC with findings that name the part and the code. Every compile also draws the schematic. Routes are cached per board, so an unchanged board compiles from its route file.
