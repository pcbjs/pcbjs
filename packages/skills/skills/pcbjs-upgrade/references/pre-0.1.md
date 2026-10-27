# Migrating from before 0.1

Everything that changed while pcbjs was a proof of concept, before releases and a changelog. Apply the sections that match the project; each says how to find what needs changing.

## The package split

pcbjs was one package, `pcbjs`. It is now one package per component, and projects install `@pcbjs/pcbjs`, which provides the `pcbjs` command and depends on every component. Design code imports the components directly.

Find: `grep -rn "from 'pcbjs" --include=*.ts --include=*.tsx .` and `"pcbjs"` in `package.json`.

| Before | After |
| --- | --- |
| `import PCB, { nets, route } from 'pcbjs'` | `import PCB, { nets, route } from '@pcbjs/core'` |
| `from 'pcbjs/lib'` | `from '@pcbjs/lib'` |
| `from 'pcbjs/lib/rules'`, `'pcbjs/lib/stackups'` | `from '@pcbjs/lib/rules'`, `'@pcbjs/lib/stackups'` |
| `from 'pcbjs/fab/JLCPCB/2-Layer'` | `from '@pcbjs/fab/JLCPCB/2-Layer'` |
| `bindPCB` from the fab module | `import { bindPCB } from '@pcbjs/fab'` |
| `compileBoards` | `import { compileBoards } from '@pcbjs/compile'` |
| `kicadFootprint` | `import { kicadFootprint } from '@pcbjs/kicad'` |
| `"devDependencies": { "pcbjs": … }` | `"@pcbjs/pcbjs"`, `"@pcbjs/core"`, `"@pcbjs/lib"`, `"@pcbjs/fab"`, and any other component imported |

Packages import each other by name, never by a path into another package's `src` or `dist`. `@pcbjs/core` is a singleton: every other package takes it as a peer, so a project must resolve exactly one copy.

## jsxImportSource

```diff
-    "jsxImportSource": "pcbjs",
+    "jsxImportSource": "@pcbjs/core",
```

In `tsconfig.json`, with `"jsx": "react-jsx"`. A per-file pragma, `/** @jsxImportSource pcbjs */`, changes the same way.

## The config file

`pcbjs.config.{ts,mts,js,mjs}` became `pcb.config.{ts,mts,js,mjs}`. The old name still loads, with a deprecation warning. Every command reads its boards from `entries`; with neither entries nor boards on the command line a command fails and names `entries`. A project with one board names it `pcb.tsx`.

```ts file=pcb.config.ts
import { defineConfig } from '@pcbjs/core'

export default defineConfig({ entries: ['pcb.tsx'] })
```

`defineDefaultRules` and `defineDefaultBoard` are process-wide: move calls out of a board module into the config, or into `<PCB rules>` of each board, or every board compiled after it changes.

## Route path strings to chains

`route(a, b, path)` with a path string is the compatibility form and still compiles. Chains are what the docs, findings and the editor's segments use, and they type-check each step.

| Path | Chain |
| --- | --- |
| `route(a, b)`, `route(a, b, 'XZ')` | `route(a).X(b)` |
| `route(a, b, 'Z')` | `route(a).Z(b)` |
| `'H 10 V 5 Z'` | `.H(10).V(5).Z(b)` |
| `'h 2 v -1 XZ'` | `.h(2).v(-1).X(b)` |
| `'L 5 16 @B.Cu XZ'` | `.L(5, 16).via('B.Cu').X(b)` |
| `'U B.Cu'`, the older via spelling | `.via('B.Cu')` |
| `'X 12 8 XZ'`, a waypoint | `.X('12 8').X(b)` |

```diff
-{route(J1[3], Q1[1], 'V 14 L 5 16 @B.Cu H 24 XZ').width(0.25)}
+{route(J1[3]).V(14).L(5, 16).via('B.Cu').H(24).X(Q1[1]).width(0.25)}
```

The legacy object form, `route(net, { d, from, to })`, still works for a track drawn by an SVG path; prefer `<track d>` for that.

## Pin positions to pad numbers

A number key used to be a position in the part's pin list. It is now always a pad number:

| Expression | Before | Now |
| --- | --- | --- |
| `U1[7]`, `U1['7']` | the seventh pin | the pad numbered 7, whatever pin sits there |
| `.connect({ 4: N })` | the fourth pin | the pin on pad 4 |
| `.pin(3)` | the third pin | an error: `.pin()` takes a pin name |
| `.pad('B4')` | the pad B4 | unchanged |

On headers and most KiCad imports the pin on pad n is named n, so nothing moves. It matters on a footprint whose pins are named and whose pin order differs from its pad numbers. An unknown number throws `has no pad numbered "9"`.

Find: `grep -nE "\[[0-9]+\]|\.pin\([0-9]" *.tsx *.ts`, then for each part whose pins are named, compare its pin order with its pad numbers in `pcbjs inspect U1`. Rewrite a positional reference by name:

```diff
-route(U1[2]).X(J1[1])          // second pin, GND
+route(U1.GND).X(J1[1])
```

Pad ids type-check when `defineFootprint` lists `pads` inline or `as const`: `U1[7]` is a `PadRef<'7'>` and a number not in the list is an editor error.

```tsx file=footprint.tsx
import { defineFootprint, type FootprintProps } from '@pcbjs/core'

function Body(props: FootprintProps) {
  const { children, ...rest } = props
  return (
    <footprint id="my:SOT-23" {...rest}>
      <pad num={1} name="B" at="-0.95 1" size={[0.6, 0.9]} />
      <pad num={2} name="E" at="0.95 1" size={[0.6, 0.9]} />
      <pad num={3} name="C" at="0 -1" size={[0.6, 0.9]} />
      {children}
    </footprint>
  )
}

export const NPN = defineFootprint(Body, { pins: ['B', 'E', 'C'], pads: [1, 2, 3], prefix: 'Q' })
const Q1 = NPN('MMBT3904')
export const base = Q1.B
export const pad3 = Q1[3]
```

## Model files

The model option's `step` key is now `file`, which takes STEP, glTF, GLB and WRL; `step` still works. Paths are relative to the file that holds the `model` literal.

```diff
-model: { step: './models/part.step' }
+model: { file: './models/part.step' }
```

## Route cache

The route file `.pcbjs/routes/<board>.json` keys every leg on `ROUTER_VERSION` and every tuning step on `TUNE_VERSION`. A release that changes routing or tuning bumps them, so stale entries are ignored and the first compile after the upgrade routes everything again, locked legs included. That compile is a cold check: compare its findings and `inspect --lengths` with the baseline, then `.lock()` again what you want pinned. Nothing needs deleting by hand. The reference cache, `.pcbjs/references/`, and the model cache, `.pcbjs/models/`, are keyed on content hashes and need nothing either.

## Rules that became objects

- `holeClearance` takes `{ inner, outer }` and `minHoleToHole` takes `{ pad, via }`; `JLCPCB` now carries `minHoleToHole: { pad: 0.45, via: 0.2 }`. Code that reads `rules.minHoleToHole` from a preset as a number must handle the object; a compiled board's rules give the larger side.
- `clearance` on a part, pad, net or class takes an object by the other item's kind, `{ pad, track, via, zone, text }`, and toward pads by type, `{ pad: { tht, smd } }`. A plain number keeps its meaning.

## Checks that are new

A board that was clean may show new findings after an upgrade. They are checks, not regressions:

- `mask-web` warnings: the `JLCPCB` rule set carries a 0.1 mm mask web.
- `edge-courtyard`, `edge-silk`, `edge-pad` only with an `edge` band, `reference-net` only with `mate.nets`: both opt in.
- `courtyard` no longer warns on an overlap under 10 µm.
- Silk refs are no longer drawn for test points, pogo pads, fiducials and mounting holes; `ref={false}` on them can go, and `refAt` brings one back.
- `teardrop-dropped` is an info finding and never counts.
