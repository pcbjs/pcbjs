---
title: Projects and modules
description: Config discovery, entry resolution, configuration fields and source-module structure.
---

# Projects and modules

A project registers board entry modules and the defaults used to evaluate them. This page defines that source structure; [workspace discovery](../architecture/workspace) defines how a session finds several projects.

## Configuration discovery

The normal config names, searched in this order in the project root, are `pcb.config.ts`, `pcb.config.mts`, `pcb.config.js` and `pcb.config.mjs`. An explicit `--config` selects another file; a missing explicitly selected file is an error. Do not assume an arbitrary filename will be discovered automatically.

A minimal complete config is:

```ts
import { defineConfig } from '@pcbjs/core'

export default defineConfig({ entries: ['pcb.tsx'] })
```

This config registers an entry; it does not itself declare or place a board entity. The [Quickstart](/guide/getting-started/quickstart) supplies a complete board module and its corresponding preview.

`defineConfig` is a typed identity helper, not a universal runtime schema validator. The CLI loads the config and applies its resolution checks. Config evaluation precedes entry evaluation, so it is the appropriate place to register shared board defaults and project plugins.

## Configuration fields

The exact interface is [UserConfig](https://github.com/pcbjs/pcbjs/blob/main/packages/core/src/config.ts).

| Field | Default / meaning |
| --- | --- |
| `entries` | Optional list of entry paths or globs, relative to the config directory; a compiling command must obtain entries from config or its explicit arguments |
| `outDir` | `.pcbjs/dist`; output directory for the static viewer site |
| `fabDir` | `.pcbjs/fab`; loose fabrication outputs |
| `base` | `/`; site URL base; a relative base such as `./` builds a client-rendered site only |
| `vite` | Additional Vite options merged with the site's configuration |
| `repo` | Optional source-link configuration: required URL, optional ref, directory and host kind |
| `kicad` | Optional footprint search folders and model-library root |
| `plugins` | Empty by default; project plugins precede board-local plugins |
| `session` | Editing access policy; `edit` is `localhost`, `all` or `none`, defaulting to `localhost` |
| `lib` | Optional `exports` map for `pcbjs build --lib`; keys are public module entry names and values identify source modules |

Relative output directories resolve through the CLI's project root. The resolver tracks the config and its imports as dependencies. Model literals, imported assets and library paths have their own documented resolution rules; they are not all relative to the config file.

## Entry resolution

Explicit command-line entries replace the config's entries for that run. Config patterns expand in declaration order, each glob's results sorted, with duplicates removed. A missing explicit path, a glob with no matches, or no entries from either source produces an error. Commands that only need settings do not necessarily require a board entry.

An entry default-exports a board or a supported variant collection. The board's `name` identifies its outputs and viewer data; conflicting board names across entries are an error. Names such as `pcb.tsx` and `<board>.pcb.tsx` are conventions, not semantic requirements. The exact discovery and resolution implementation is [project/config.ts](https://github.com/pcbjs/pcbjs/blob/main/packages/cli/src/project/config.ts).

## Source modules

| Module role | Expected contents |
| --- | --- |
| Board entry | Imports, board root, outline, placements, copper and other board geometry |
| Schematic module | Nets, connected parts, circuit instances and optional schematic drawing |
| Small reusable group | Exported `schematic` plus `layout` and named layout variants in one TSX module |
| Sourcing module | Part sourcing assignments imported by the entry |
| Config | Entry registration and shared project settings/defaults |

These roles can share files when useful. Splitting a reusable circuit and its layout is not required for source mapping. Use explicit runtime layout names to distinguish variants. A conventional file organization does not create a hidden dependency: the entry/config must import the modules whose values or side effects it needs.

`schematic={sch}` lets the source transform expose a schematic module's exports in the board scope. Ordinary explicit imports also work. A TypeScript editor needs the matching plugin for this injected scope; the compile/type-check path is still authoritative for the project.

## TypeScript and evaluation boundaries

TSX uses the pcbjs JSX runtime, conventionally configured with `jsx: react-jsx` and `jsxImportSource: @pcbjs/core`. TypeScript remains the host language: functions, arrays and asynchronous setup execute as code. The emitted nodes are pcbjs values, not React elements.

Valid TypeScript does not imply a valid physical design. Compilation separately checks placement completeness, duplicate names, dependency cycles and geometric constraints. DRC/ERC findings describe the compiled design. Treat syntax/type errors, compile failures and findings as different outcomes in clients and automation.

See [Board roots](./board), [Circuits and layouts](./circuits), [Source-to-entity focus](../interaction/highlight) and [Setup](/guide/getting-started/npm-setup) for the next layer of detail.
