# Models: reuse, author and validate

`pcbjs model add`, `align` and `check`: fetch a STEP, glTF or WRL model, fit it to a placed part, write the `model` option, and where to find models and what their licences allow.
Advanced. The model descriptor, its frame and the user model cache are in 3d.md.

```sh
pcbjs model add https://example.com/JK0654219NL.stp --ref J1 --write
pcbjs model add lcsc:C965555 --ref D2 --write
pcbjs model add --ref D2 --write        # the part's MPN:LCSC number
pcbjs model align J1
pcbjs model check
pcbjs shot --view 3d --select J1
```

Stdlib parts fetch their own models, see 3d.md Fetched on first use; `pcbjs model fetch` gets them at once.

## Choose a model

1. Keep a part's existing model when it represents the package correctly.
2. Use a generated descriptor for standard chip passives, LEDs, headers or simple package bodies. See 3d.md Model descriptors.
3. Source a matching KiCad or manufacturer model when its mechanical detail matters.
4. Compose an approximate custom body with the shared modeling API below when no suitable model exists. Record dimensions, provenance and approximations alongside its script.

A 3D body does not define copper pads, pin numbering or electrical connectivity. A visually plausible body is not a verified footprint.

## Author a custom body

The standard library generates meshes, not STEP solids. `@pcbjs/ui/models` exposes the same palette and geometry through `composeModel`; `modelGlb` writes a model asset using pcbjs's exporter:

```js
import { writeFileSync } from 'node:fs'
import { composeModel } from '@pcbjs/ui/models'
import { modelGlb } from '@pcbjs/export'

const model = composeModel([
  { shape: 'box', size: [10, 10, 1], radius: 0.15, material: 'mould' },
  { shape: 'box', size: [8, 8, 0.3], radius: 0.1,
    translation: [0, 0, 1], material: 'tin' },
])
writeFileSync('models/custom.glb', modelGlb(model, 'custom'))
```

Run the script from the project root after creating `models/`, then set the part's `model` to `{ file: './models/custom.glb' }`, relative to the source file. Keep the script in the project so the asset is reproducible. This API does not provide boolean solids, textures or STEP export.

| Part | Shape parameters |
| --- | --- |
| `box` | `size: [x, y, z]`, optional `radius` or `chamfer` |
| `cylinder` | `radius`, `height`, optional `segments` (32 by default) |
| `sphere` | `radius`, optional `segments` (32 by default) |
| `generated` | `spec`, a generated descriptor; `context: { height, thickness }` |

All parts accept `translation: [x,y,z]` in mm and quaternion `orientation: [x,y,z,w]`. Rotation precedes translation. The right-handed frame is footprint X, negative footprint Y, Z up. Boxes and cylinders start at Z=0; spheres are centred at the origin. Generated parts retain their materials unless overridden.

Use a named `material` such as `mould`, `plastic`, `tin`, `gold`, `ceramicCap` or `ferrite` for consistency. An explicit material accepts `color` as hex plus `metalness`, `roughness`, `opacity`, `alphaMode`, `alphaCutoff`, `doubleSided` and `emissive`. See 3d.md for the supported import/export subset.

For raw meshes, preserve counterclockwise front-face winding and outward normals. Reflecting coordinates, such as swapping Y/Z without a sign change, also requires reversing winding. Validate after conversion: a correct bounding box does not prove correct surfaces.

## model add

`pcbjs model add <file-or-url> [--ref J1 | --footprint <id>] [--entry <board>] [--as <name>] [--write] [--force]`

| Flag | Effect |
| --- | --- |
| `<file-or-url>` | copied or downloaded into `models/`; a zip is unpacked to its first model file |
| `lcsc:<C-number>` | EasyEDA's model of the LCSC part, no login |
| `--ref` | fits to that placed part as align does and prints the `model` option; alone, uses the part's `MPN:LCSC` number |
| `--footprint <id>` | fits to the first part with that footprint; `--write` goes on the `<footprint>` element found by `id`, so every part of it gets it |
| `--write` | writes the option into the code, the path relative to that file |
| `--entry` | add and align: the board, when a ref is on several, by board name, entry or folder |
| `--as`, `--force` | file name; overwrite |

- It prints the model's box in mm and unit guess and appends source and date to `models/LICENSES.md`; a licence in the zip, such as Hirose's `Read me.pdf`, is saved as `<model>-<file>`.
- A download goes through the user model cache, kept by content: adding the same `lcsc:` part again, in any project, needs no network, the same URL asks the server with its ETag or Last-Modified and downloads only a changed file, and either prints `from the model cache` when it takes the cached copy; the copy in `models/` is the project's own file. 3d.md Model cache has where the cache lives and `pcbjs model cache ls|prune|path`.
- `--write` puts the model in the options after the value: `R0603('10k')` becomes `R0603('10k', { model })`, `R0603('10k', { dnp: true })` becomes `R0603('10k', { dnp: true, model })`, and a call with no value gets the options alone, `PinHeader(4)()` becomes `PinHeader(4)({ model })`, and `PinHeader(4)()` becomes `PinHeader(4)({ model })`.
- Without a board for a shared ref, such as `--entry sense.tsx`, add and align refuse and list the boards.

## model align

`pcbjs model align <ref> [--entry <board>] [--file <model>]` prints `offset`, `rotate`, `scale`, the pins matched, a confidence from 0 to 1 and the `shot` command.

- The unit comes from the courtyard; of the 24 ways to stand and turn the model it keeps the one with most pins on pads, as drawn unless the pins clearly disagree, or by `height` without pins.
- It keeps what fits: the part's transform, such as KiCad's `(model ...)` line, and the file's own frame stay when they land as many pins. A new fit snaps to 0, the pad pitch or half of it within 0.1 mm.
- The seat is the file's z = 0 when the model sits on it, or a through-hole part's pins pass it under a standoff body such as TO-220; else the body underside for through-hole and the lowest contacts for SMD.
- Inches, a corner or pin 1 origin, and a model on its side become `scale`, `offset` and `rotate`. Confidence under 0.5 or an equal turn means symmetric pins such as LGA or QFN: check pin 1 in the shot.

## model check

`pcbjs model check [entry...]` lists every footprint's model source: `file`, `generated` with its kind, `no model` or `no body`, with counts. It flags missing, unreadable or misplaced files, parts waiting on `pcbjs model fetch`, and invalid mesh geometry. It checks both imported and generated meshes for malformed arrays, invalid indices, nonfinite positions/normals, zero normals and winding opposite the supplied normals. Degenerate triangles are warnings; other issues exit 1. It never repairs geometry automatically. The scope line counts file-fit and mesh checks actually run; structured rows expose these as `coverage.fit` and `coverage.mesh`. Missing or unreadable geometry is not mesh-checked. Fit and mesh checks do not verify manufacturer dimensions, watertightness or outward-facing surfaces; inspect the relevant views for appearance.

The MCP `models` tool returns the same inventory and checks as structured rows with per-mesh issue counts, from the session's current compiled source. `render` supplies visual acceptance. Neither check establishes watertightness, correct outward orientation of an entire closed body, material realism, pin-1 alignment or electrical correctness. Inspect top, underside, sides and a close-up after changes. A clean DRC/ERC result also does not certify model quality.

## Where to find models

Checked from a script in October 2026:

| Source | Access |
| --- | --- |
| KiCad, `gitlab.com/kicad/libraries/kicad-packages3D` | raw files, no login, STEP and WRL; fits a stdlib part of the same land pattern with no transform |
| LCSC's EasyEDA via `lcsc:<C-number>` | no login; many parts KiCad lacks |
| Hirose | `pcbjs model add '<url>'` with `https://www.hirose.com/en/product/p/<CL code>/documents?path=%2Fapi%2Fv1%2Fproducts%2F<CL code>%2Fdocuments%2Fmodel_3d_step%2Fcontent`; curl needs a browser User-Agent; its `Read me.pdf` forbids redistribution |
| JST, Molex, Würth, GCT | JST asks for an email, the others refuse scripts: download in a browser |
| Bosch, ST, TI | no STEP of their own, link SnapEDA or Ultra Librarian |
| SnapEDA, Ultra Librarian | free account |

glTF and GLB work too; Draco or meshopt compression must be exported again without it.

## Licences

Manufacturer models usually allow use but not redistribution. KiCad's are CC-BY-SA 4.0 with an exception for designs and generated files. EasyEDA, SnapEDA and Ultra Librarian terms apply to their downloads. `models/LICENSES.md` keeps each file's source and its zip's licence file; check the terms before publishing a repository or site with the model, and gitignore one you may not redistribute.
