---
title: Examples
description: The demo boards and the review boards of the pcbjs repository, with shots and the numbers from pcbjs check.
aside: false
---

# Examples

Every folder under [examples/](https://github.com/pcbjs/pcbjs/tree/main/examples) is a pcbjs project: clone the repository, build it, and run `pcbjs check` in one. The demo boards are the small ones the documentation refers to. The review boards were each built by a reviewer from an empty folder to an orderable board, and are larger: USB hubs, an Ethernet PHY, an SDRAM, a buck converter, a stack of three boards.

The numbers on each card come from `pcbjs check --json` at the time the site was built: parts, pads, tracks, vias, nets, the legs the autorouter laid, the DRC and ERC counts and the compile time. The pictures are `pcbjs shot` of the same build, 3D and 2D.

<Gallery />
