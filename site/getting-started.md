---
title: Getting started
description: Install pcbjs, make a project, and run the check, dev and build loop.
---

# Getting started

Node 22.12 or newer; `@beta` is the npm tag until 0.1.

```sh
npm install -D @pcbjs/pcbjs@beta
npx pcbjs create my-board
cd my-board && npm install
```

## Three commands

```sh
npx pcbjs check   # compile, route, DRC and ERC
npm run dev       # the viewer on http://localhost:5173, recompiled on save
npm run build     # the fab set in .pcbjs/fab, the site in .pcbjs/dist
```

## A board

Blinky's layout, from `examples/demo`:

<<< @/../examples/demo/blinky.pcb.tsx#example{tsx}

## Next

- [Quick start](/docs/quickstart): the project files and the config.
- [Schematic](/docs/schematic) and [Layout](/docs/layout): nets, parts and elements.
- [Routing](/docs/routing): manual tracks, automatic legs, pairs and lengths.
- [Findings](/docs/findings): every DRC and ERC rule.
- [Examples](/examples): every board in the repository.
