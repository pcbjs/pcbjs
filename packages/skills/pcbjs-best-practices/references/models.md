# Reuse and validate 3D models

A part's model matters for the 3D view, the `reference-collision` heights and an enclosure check. `pcbjs docs models` has the commands; this is the order that worked.

## Choose the smallest suitable model

Keep a part's existing model. Standard chip passives, LEDs, headers and simple IC bodies can use generated descriptors from `pcbjs docs 3d` without writing a mesh file. A descriptor must match the package; the generic IC body is not a detailed BGA and the header generator does not cover every connector.

When exact mechanical detail matters, source a model:

1. The KiCad library, `gitlab.com/kicad/libraries/kicad-packages3D`, raw files, no login. A KiCad model of the same land pattern usually fits a standard library part with no transform.
2. The maker's own STEP. Many sites serve it to a script once you find the document URL the product page uses; a browser User-Agent may be needed. `pcbjs model add '<url>'` unpacks a zip to its first model file.
3. LCSC's EasyEDA library, `pcbjs model add lcsc:C123456 --ref U5 --write`, or `--ref` alone for a part with an `MPN:LCSC` number.
4. For unavailable models, author an explicit approximation using `composeModel` from `@pcbjs/ui/models` and `modelGlb` from `@pcbjs/export`. `pcbjs docs models` has a complete script. These reuse stdlib primitives and materials; there is no STEP generator. Keep script, dimensions, sources and limitations together.

Use `reference()` for a board assembly, with a 3D pose when needed, instead of baking board instances into component assets. A model body does not supply copper pads, numbering or nets; verify those independently.

## Custom geometry

- Prefer named materials such as `mould`, `tin`, `gold` and `ceramicCap` over recreating the palette. Compose boxes, cylinders, spheres or existing generated descriptors. Do not import private UI helpers or hand-encode glTF buffers.
- Author in mm, in the right-handed model frame: X along footprint X, Y along negative footprint Y, Z up. `composeModel` takes translation and quaternion orientation; `modelGlb` converts to metres/Y-up.
- Raw meshes need counterclockwise front faces and outward normals. A coordinate reflection also reverses winding; swapping Y/Z alone is a reflection. Double-sided rendering cannot repair incorrect normals.
- The supported glTF material subset is base colour, metalness, roughness, opacity/alpha mode, cutoff, sidedness and emissive colour. Textures, animation and material extensions are unsupported. Use static geometry and scalar materials.

## Fit and check

```sh
pcbjs model add https://example.com/part.stp --ref J1 --write
pcbjs model align J1
pcbjs model check
pcbjs shot --view 3d --select J1
pcbjs shot --view 3d --select U1 --side B
```

With MCP, use `models` for the same inventory and structured mesh checks, then `render` for visual inspection. Checks flag invalid arrays/indices, nonfinite or zero normals and winding disagreement; degenerate triangles are warnings. They do not prove watertightness, outward-facing solids, realistic materials or electrical correctness. Inspect top, back, side and close-up views after changes, including pin 1, seating height and connector openings.

- A confidence under 0.5 from `align`, or a model without distinct pins, means look at the shot and check pin 1 by eye. For an axial or symmetric part, read the axis from the file and set `rotate` and `offset` by hand.
- `--footprint <id>` fits once for every part of that footprint.
- In a project of several boards, name the board with `--entry`.
- A VRML file is in units of 2.54 mm and its y is the footprint's -y.
- A `fallback` shows while the mesh loads or when the file is missing: a generated body such as `{ kind: 'ic', w, h, height }`, or `{ kind: 'box', w, h, height }`, which draws the dashed `no model` outline.

## Licences

- `pcbjs model add` appends the source URL and date to `models/LICENSES.md`. Add the licence terms you found.
- Open the archive and read any licence file in it: many maker models allow use in your designs but forbid redistribution.
- A model that may not be redistributed stays out of git: add it to `.gitignore` and fetch it from a make target the check target depends on, with the URL in the Makefile and a `fallback` on the part.
- KiCad's models are CC-BY-SA 4.0 with an exception for designs and generated files; EasyEDA, SnapEDA and Ultra Librarian have their own terms.
- Check the terms before publishing a repository or a built site, which carries the meshes.
