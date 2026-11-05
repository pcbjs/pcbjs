# Library

A project published as an npm package of its parts, circuits, footprints and boards: `pcbjs build --lib`, what the package holds, and how another project uses it.
Advanced. Read it to share a circuit or a board between projects, to reference a board another package ships, or to place several boards in one 3D model with `compose()`.

```ts
import { defineConfig } from '@pcbjs/core'

export default defineConfig({
  entries: ['pcb.tsx'],
  lib: { exports: { '.': './index.ts', './ldo': './ldo.tsx' } },
})
```

`pcbjs build --lib` writes the package into `dist`, or `--out-dir`, from the config's `lib.exports`, a map of package entries to modules, and every board of `entries`. The project's `package.json` gives the name and version. `examples/library` holds a library, `power`, and a board that uses it, `consumer`.

## What the package holds

| File | What it is |
| --- | --- |
| `package.json` | the project's name and version, an entry per module and per board, `@pcbjs/core` and each pcbjs package the modules import as peers of this train, `>=0.N.0-0 <0.N+1.0` |
| `<module>.js`, `.d.ts`, `.js.map` | each module of `lib.exports` as ES modules in shared chunks, `chunks/`, with its types and a source map carrying the sources |
| `boards/<name>/` | per board: the facets `meta`, `sch`, `layers`, `model`, `findings` and `fab` as JSON, `reference.json`, `mesh.bin`, `model.glb`, `2d.svg`, `sch.svg` and `index.js` |
| `pcbjs.json` | `{ format, compile, core }`: the versions that built it |

- The modules take the CLI's transforms before they are written, the scope injection and the binding capture, since a consumer's Vite never transforms `node_modules`: a part's name is baked in where the library declares it.
- Packages stay external: the library imports `@pcbjs/core` and `@pcbjs/lib`, never a copy of them.
- `boards/<name>/index.js` exports `board`, a `BoardRef` for the views of ui.md with its files as `new URL('./layers.json', import.meta.url)` so bundlers copy them, `meta`, its summary, and `model`, the URL of its GLB.
- A board's entry is `./boards/<name>` with the condition `pcbjs` on `reference.json`, which `reference()` reads, and `default` on `index.js`.
- `lib: { exports: {} }` ships boards alone; a library with no `entries` ships modules alone.

## What a module may hold

An exported module holds factories, footprints, circuits and layouts. A part made when the module loads, a top-level `const R1 = R0603('10k')`, fails the build naming it, since every consumer would place that ref: make it inside a circuit, whose instance names it.

```ts
import { circuit, type Ports } from '@pcbjs/core'
import { C0805, SOT223, withPins } from '@pcbjs/lib'

export const AMS1117 = withPins(SOT223, ['GND', 'VOUT', 'VIN'])

export const schematic = circuit('ldo', ({ VIN, VOUT, GND }: Ports<'VIN' | 'VOUT' | 'GND'>) => ({
  U01: AMS1117('AMS1117-3.3').connect({ VIN, VOUT, GND }),
  C01: C0805('10u').connect({ 1: VIN, 2: GND }),
  C02: C0805('22u').connect({ 1: VOUT, 2: GND }),
}))
```

## Using a library

Small modules export `schematic` alongside `layout` and any named layout variants from the same `.tsx` file, as in circuits.md. Consumers give these exports descriptive local aliases.

Install the package and import its modules as any other. An instance takes its index in the consumer, circuits.md: `ldo(ports, 2)` places `U201`, `C201` and `C202`, the path `ldo2/U01`.

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, reference } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'
import { schematic as ldo, layout as LdoBlock } from '@acme/power/ldo'

const { VIN, V3V3, V3AUX, GND } = nets()
const J2 = PinHeader(3)().connect({ 1: VIN, 2: GND, 3: V3V3 })
const AUX = ldo({ VIN, VOUT: V3AUX, GND }, 2)

export default (
  <PCB name="Carrier">
    <J2 at="12 20.46" />
    <LdoBlock g={AUX} at="28 9" />
    {reference('@acme/power/boards/PowerModule', { mate: { local: J2, remote: 'J1', pin: 1, nets: true } })}
  </PCB>
)
```

- `reference()` takes a package's board: a path that starts with neither `.`, `/` nor `file:` is a package specifier, found from the calling file as Node finds packages, and its `pcbjs` condition read with no compile, references.md.
- Reference data of another format than this pcbjs reads fails the compile naming the package to rebuild.
- Names stay apart across the boundary: nets of a circuit are scoped by instance path as always, a footprint keeps the identity of its factory so two libraries' footprints of one name never merge, and the BOM groups by part number and value.
- Findings name the library's files by their path in the library, such as `ldo.tsx:12`.
- `pcbjs doctor` lists each installed library with the core it was built with, and warns when that is another major.minor than the one installed.

## compose()

```ts
import { writeFileSync } from 'node:fs'
import { compose } from '@pcbjs/export/compose'

const glb = await compose(
  [
    { board: 'dist/boards/Carrier' },
    { board: 'node_modules/@acme/power/boards/PowerModule', mate: { local: 'J2', remote: 'J1', pin: 1 } },
  ],
  { format: 'glb' },
)
writeFileSync('stack.glb', glb)
```

- `compose(boards, { format: 'glb' })` writes one GLB of library boards, each under a node `board:<name>`, the first at the origin and each later one placed against it by `mate`, `at` or `pose`, as `reference()` places it: the same options, with a part of the first board named by its ref, `J2` or `J2/1`. A `pose` carries 3D `translation` and quaternion `orientation`, using the frame, pivot and normalization contract in references.md; it cannot be mixed with other placement options.
- A board is its folder or `reference.json` as a path or URL, or the `board` its `index.js` exports, which carries the URLs of its reference data and GLB.
- Panels are a compile stage, never a `compose()`. STEP joins `glb` when pcbjs writes a board as STEP.

## Versions

- The library has its own semver; `pcbjs.json` records the train that built it.
- Prebuilt boards are data under the reference format, so a pcbjs of another format asks for a rebuild; the modules are bound by the peer range of `@pcbjs/core`.
