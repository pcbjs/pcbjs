# @pcbjs/compile

## 0.0.1-beta.0

### Patch Changes

- [`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6) Thanks [@zhangyx1998](https://github.com/zhangyx1998)! - First beta. Compiles a board into one model: placement, manual and automatic routing with negotiation, differential pairs and length tuning, pours and stitching, silk reference placement, connectivity, and DRC and ERC with findings that name the part and the code. Every compile also draws the schematic. Routes are cached per board, so an unchanged board compiles from its route file.
- Updated dependencies [[`9029beb`](https://github.com/pcbjs/pcbjs/commit/9029beb783788cfbb471cc9d57e1b47864c6eaa6)]:
  - @pcbjs/core@0.0.1-beta.0
