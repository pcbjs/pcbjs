# 3D models from vendors

A part's model matters for the 3D view, the `reference-collision` heights and an enclosure check. `pcbjs docs models` has the commands; this is the order that worked.

## Where to look, in order

1. The KiCad library, `gitlab.com/kicad/libraries/kicad-packages3D`, raw files, no login. A KiCad model of the same land pattern usually fits a standard library part with no transform.
2. The maker's own STEP. Many sites serve it to a script once you find the document URL the product page uses; a browser User-Agent may be needed. `pcbjs model add '<url>'` unpacks a zip to its first model file.
3. LCSC's EasyEDA library, `pcbjs model add lcsc:C123456 --ref U5 --write`, or `--ref` alone for a part with an `MPN:LCSC` number.
4. A model you write: a short script that emits a VRML or STEP of the mounted stack, for a module on sockets or a dev board on headers that has none.

## Fit and check

```sh
pcbjs model add https://example.com/part.stp --ref J1 --write
pcbjs model align J1
pcbjs model check
pcbjs shot --view 3d --select J1
pcbjs shot --view 3d --select U1 --flip
```

- A confidence under 0.5 from `align`, or a model without distinct pins, means look at the shot and check pin 1 by eye. For an axial or symmetric part, read the axis from the file and set `rotate` and `offset` by hand.
- `--footprint <id>` fits once for every part of that footprint.
- In a project of several boards, name the board with `--entry` or `--ref Board/J1`.
- A VRML file is in units of 2.54 mm and its y is the footprint's -y.
- A `fallback` shows while the mesh loads or when the file is missing: a generated body such as `{ kind: 'ic', w, h, height }`, or `{ kind: 'box', w, h, height }`, which draws the dashed `no model` outline.

## Licences

- `pcbjs model add` appends the source URL and date to `models/LICENSES.md`. Add the licence terms you found.
- Open the archive and read any licence file in it: many maker models allow use in your designs but forbid redistribution.
- A model that may not be redistributed stays out of git: add it to `.gitignore` and fetch it from a make target the check target depends on, with the URL in the Makefile and a `fallback` on the part.
- KiCad's models are CC-BY-SA 4.0 with an exception for designs and generated files; EasyEDA, SnapEDA and Ultra Librarian have their own terms.
- Check the terms before publishing a repository or a built site, which carries the meshes.
