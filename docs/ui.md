# UI components

The viewer's 2D, 3D, schematic and DRC/ERC views, its chip, findings list and panels as Vue components in `@pcbjs/ui`, and the `?pcb:` imports of `@pcbjs/cli/vite` that hand them a board, for a site of your own built with Vite.
Advanced. viewer.md describes what the views do; this topic how to put them on a page.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { pcbjs } from '@pcbjs/cli/vite'

export default defineConfig({ plugins: [vue(), pcbjs()] })
```

```vue
<script setup lang="ts">
import { View2D, View3D, FindingsList } from '@pcbjs/ui'
import '@pcbjs/ui/style.css'
import board from '../boards/pcb.tsx?pcb:board'
import findings from '../boards/pcb.tsx?pcb:findings'
</script>

<template>
  <p>{{ findings.drc.length }} DRC findings</p>
  <View2D :board="board" style="height: 420px" />
  <View3D :board="board" arm="click" style="height: 420px" />
  <FindingsList :board="board" />
</template>
```

`@pcbjs/ui` is prebuilt ESM with one `style.css` and its types; `vue` and `three` are peers, `@pcbjs/core` its one dependency, `@pcbjs/export` and `@pcbjs/step` optional peers for the types of its scene modules. three.js loads with the first 3D view, in a chunk of its own, its geometry worker inlined.

## The `?pcb:` imports

A module whose default export is a `<PCB>`, an entry of the config or not, takes `?pcb:<facet>`; its project is the nearest `pcb.config.*` above it, config and defaults loaded as for an entry.

| Import | Default export |
| --- | --- |
| `?pcb:meta`, `sch`, `layers`, `shapes`, `model`, `findings`, `fab` | the facet of viewer.md as data, inlined into the importing chunk |
| `?pcb:board` | a `BoardRef` for the components: the summary and each facet's URL, fetched as a view needs it |
| `?pcb:poster`, `?pcb:poster&view=sch` | the URL of the board's top view as SVG, or of the schematic's |
| `?pcb:module` | the `BrowserModule` of browser.md: the design as browser ESM with its files, route memo and references, for a compile in the page |

- `&target=<name>` picks a variant, the first target without it. Another facet name fails the import with the list above.
- Every facet module also exports `header`: `{ entry, board, target, facet, run, hash }`, `run` the compile that made it, ordered, and `hash` its content.
- With an absolute Vite deployment base, poster and facet URLs have the same spelling in server-rendered HTML and browser modules. Relative browser builds keep chunk-relative asset URLs.
- A worker thread per project compiles, with its own config, globals and Vite SSR. The data facets compile as `pcbjs check` does and share its stage cache, so a warm build evaluates nothing and the hashes match check's; `?pcb:sch` alone runs no routing stage. `board` and `poster` compile every stage with the SVGs.
- In dev, when `.pcbjs/dev.json` names a live session serving the project, the data facets of its entries come from it, `session/facets` of session.md, and no worker starts; `pcbjs({ session: false })` turns that off.
- A build writes the board's facets and posters as hashed JSON and SVG files beside the chunks, and each STEP model's mesh once as `models/<hash>.bin`; in dev they are served under `/@pcbjs/facet/`.
- A poster is a picture: the top view, copper, silkscreen, outline and holes, at 0.01 mm, without the board's metadata and item ids.
- HMR: a change to any file the board read invalidates its facet modules. A data module updates its importers as Vite does; the `board` module accepts itself, and the store every component of that board shares takes the newer ref; when a live session compiles the board, the store follows it as a dev page does, its facets, invalidates and heartbeat on the session socket through the site's own dev server. A mounted view keeps its camera, selection and hidden layers.

`resolveBoard(file, { target?, facets? })` from `@pcbjs/cli/vite` compiles the same facets in Node, for a data loader or a test: `{ header, facets }`.

Types: add `@pcbjs/cli/client` to `types` in the tsconfig, or `/// <reference types="@pcbjs/cli/client" />`, as `vite/client` is added. Each import then types as its facet, `?pcb:board` as `BoardRef`. A pattern matches the end of the specifier, so an import with `&target=` is untyped unless the site declares it.

## Components

Every component takes `board`, a `BoardRef`, site data or a `BoardStore`. Components given the same board share one store and one pane, so a `View2D` beside a `View3D` shares selection and hover with no provider. A component inside a `PcbViewer` uses that viewer's board.

| Component | Props beyond `board` | Events |
| --- | --- | --- |
| `View2D` | the view props, `side`, `mirror`, `layers` | `update:select`, `hover`, `ready`, `update:side`, `update:mirror` |
| `View3D` | the view props, `side`, `explode` 0 to 1, `camera` `iso`, `top`, `bottom` or `fit`, `layers` | `update:select`, `hover`, `ready`, `update:explode` |
| `SchView` | the view props | `update:select`, `hover`, `ready` |
| `ChecksView` | none; uses the shared board finding focus | none |
| `PcbViewer` | `board` one or a list, `view`, `rails`, `theme` | `update:view` for `v-model:view` |
| `PathChip` | none | `isolate` with the reference, `open` with the anchor and `placement` or `definition` |
| `FindingsList` | `kinds`, `drc` and `erc`, the viewer's tab when unset; `focus` | `update:focus` |
| `LayersPanel`, `BoardPanel`, `StackupPanel`, `SheetPanel`, `SchematicPanel`, `BomPanel`, `NetsPanel`, `CircuitPanel`, `PartPanel` | none | none |

`PcbViewer` accepts `view="checks"` alongside `2d`, `3d` and `sch`. The DRC/ERC view has its own persistent list and HTML details, observing only metadata and findings. It uses the existing canonical finding focus, so selecting a finding in another pane updates its details without changing a drawing pane's mode. `@pcbjs/ui/checks` exports `ChecksView` and a fixed checks `Pane` for editor hosts.

The view props:

| Prop | Does |
| --- | --- |
| `select` | references of refs.md, the first the anchor; `update:select` reports a change, anchor first |
| `highlight` | parts and `net:` names lit as a hover |
| `frame` | a reference or `[x, y, w, h]` in board mm to frame, null for none |
| `tools` | the toolbar, scale and readout, default true |
| `arm` | `click` takes the wheel and a drag only after a click into the view, so the page scrolls past it; default `always` |
| `theme` | `light`, `dark`, `hc` or `auto`, the default, which follows `html.dark` as VitePress sets it, the page's `data-theme`, else the system |

- `hover` is `{ uids, refs, net }`, empty when the pointer leaves; `ready` `{ view }` once the view has drawn, as `data-ready` of viewer.md.
- `layers` lists the layers shown, the rest hidden; `PcbViewer` without `rails` is the embed layout, the view alone.
- On the server a view renders a box holding the poster of a `BoardRef`; it draws after hydration once the board's facets are there, the poster staying until then. Nothing touches `window`, `document` or three.js during setup.
- A component reads `board` once: give a component for another board a `key`.
- `useBoard(input)` returns the shared `BoardStore`: `name`, `target`, `site`, `run`, `facets`, `state` `poster`, `loading`, `ready` or `failed`, `sel`, `stale`, `want(facets)`, `on(fn)` and the selection's actions, `selectRef(text)` among them; no routes, page or editor state.

## Theming

The components draw from custom properties; set any of these on an ancestor or on `.pcbjs-ui` to restyle every view, the 3D materials included.

| Property | Is |
| --- | --- |
| `--pcbjs-bg` | the canvas behind the views |
| `--pcbjs-fg`, `--pcbjs-muted` | text and secondary text |
| `--pcbjs-accent` | the selection and active controls |
| `--pcbjs-error`, `--pcbjs-warn` | findings |

The stylesheet scopes its element rules to `.pcbjs-ui`, so it leaves the rest of the page alone.

## The viewer app and embedding

`pcbjs dev` and `pcbjs build` serve `@pcbjs/viewer`, a shell of routes, top bar and loading screens around these components; `@pcbjs/ui` comes prebuilt from `node_modules`, so a dev server compiles none of its components. A site that cannot bundle Vue embeds a built viewer page in an iframe instead, `?embed=1` and the messages of viewer.md.

`pcbjs dev --ui-src [folder]` serves `@pcbjs/ui` from its source with Vue HMR, for working on the components themselves: the installed package in a pcbjs checkout, or the `packages/ui` folder given. It is an escape hatch for pcbjs development, not a way to customise the viewer, and a published install, which ships `dist` only, refuses it with `--ui-src needs a pcbjs checkout`. Like `--port`, it applies when `dev` starts the session.

## Boards compiled in the page

`pcbjs({ boards: 'compile' })` makes `?pcb:board` in a build ship the board's poster and its module instead of its facet files: the project's design modules, its route memos and the compile worker of `@pcbjs/export/browser-worker` go under `pcb/`, the pcbjs packages the designs import once under `pcb/lib/` for every project, and the meshes as `models/<hash>.bin`. The first view that wants the board's facets starts its compile in the worker, one per project, and the source of every component of that board takes the facets as it would a newer ref. A view shows the poster until then, and keeps it when the browser has no module workers or the compile fails, with one console warning. In dev the facets come from Node as with the default `'data'`, so HMR stays.

- The output stays small, no board data written, at the cost of a compile in each reader's browser, a fraction of a second for a small board and a few seconds for a large one; the fab facet, which needs the exports stage, is not there.
- To stay small it ships no schematic poster, the schematic coming with the compile, and no mesh of a board shown by `reference()`, which the 3D view then draws without.
- A design reading `process.env` reads an empty environment in the browser, so a build never ships the build machine's.
- pcbjs.dev is built this way: its examples compile in the reader's browser as they scroll into view.
- `?pcb:module` is the same module for a page that runs the compile itself with `compileInBrowser`, browser.md; its URLs start with the site's `base`.

Standalone `View3D` shows a loading status until its canvas is ready and a local explanation if its async component or WebGL setup fails, retaining the poster when one is available. Connected pin and pad net cells are native buttons with pressed state and keyboard activation.

Command dialogs forward unclaimed editor shortcuts such as Cmd/Ctrl+S and Cmd/Ctrl+P while blocking background board commands; search fields retain native editing shortcuts.

Selection badges wrap within the space between the preview's left and right controls, with layout editing actions below them. On narrow panes the controls and badges occupy separate rows. The `I` shortcut toggles isolation; duplicate entity-attached action buttons are removed. Focus appearance and layer separation use separate sections below the controls; appearance choices are keyboard-accessible radio groups. Entity grids use subdued neutral tones behind the focused artwork. In 3D, fitting an isolated layout retains the exploded stack height, and Fit keeps that layout in view.
