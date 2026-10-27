# Model files from vendors

`pcbjs model add`, `align` and `check`: fetch a STEP, glTF or WRL model, fit it to a placed part, write the `model` option, and where to find models and what their licences allow.
The model descriptor, its frame and the mesh cache are in 3d.md.

## Adding a model

The standard library's switches, crystals, connectors, modules and battery holder fetch their own models on first use, see 3d.md Fetched on first use; `pcbjs model fetch` gets them all at once. When a part is not in the standard library, or its generated body is too plain, fetch a model and add it:

```sh
pcbjs model add https://example.com/JK0654219NL.stp --ref J1 --write
pcbjs model add lcsc:C965555 --ref D2 --write
pcbjs model add --ref D2 --write
pcbjs model align J1
pcbjs model check
pcbjs shot --view 3d --select J1
```

- `pcbjs model add <file-or-url> [--ref J1 | --footprint <id>] [--entry <board>] [--as <name>] [--write] [--force]` copies a file, or downloads a URL, into the project's `models/`; a zip is unpacked to its first model file. A licence or read-me file in the zip, such as Hirose's `Read me.pdf`, is saved beside the model as `<model>-<file>`, printed and named in the model's line. It reads the model once to check it parses, prints its box in mm and its unit guess, and appends its source and date to `models/LICENSES.md`.
- `lcsc:<C-number>` fetches the model of an LCSC part from EasyEDA's library, which needs no login, and notes the part and the model's URL as the source. `--ref` alone does this for a part with an `MPN:LCSC` number in its sourcing.
- With `--ref` it fits the model to that placed part as align does and prints the `model` option; `--write` puts it into the part call. The call takes the options form, `R0603('10k')` becoming `R0603({ value: '10k', model })` and `F('10k', { MPN })` becoming `F({ value: '10k', source: { MPN }, model })`; a call with an options object gets the key.
- With `--footprint <id>` it fits the model to the first part with that footprint and `--write` puts it on the `<footprint>` element, found among the files the entry imports by its `id`, so every part of that footprint gets it. A footprint used by several parts wants this rather than one `--ref` per part; `--ref` names the other parts when it sees them.
- The written path is relative to the file it is written in.
- In a project of several boards, a ref that more than one board has needs its board: `--entry sense.tsx`, or `--ref Sense/SW1` by board name, entry or folder; without one add and align refuse and list the boards. `check` writes its fixes so.
- `pcbjs model align [entry] <ref> [--file <model>]` fits the part's model file, or another file, to its pads and prints the `offset`, `rotate` and `scale`, the pins it matched and a confidence from 0 to 1, then the `shot` command. It sizes the model against the courtyard to pick the unit, tries the 24 ways to stand it on a face and turn it about z, and keeps the one whose pins land on the most pads. The file standing as drawn wins unless the pins clearly say otherwise; without pins, the footprint's `height` tells upright from lying on a side.
- Align keeps what already fits. The part's own transform, such as KiCad's `(model ...)` line of a mirrored footprint, and the file's own frame, as a KiCad library model of the same land pattern has, stay when their pins land on as many pads and on the copper. A new fit snaps to 0, or to the pad pitch or half of it, when within 0.1 mm.
- The board seat is the file's own z = 0 when the model already sits on it, or when a through-hole part's pins pass through it under a body that stands off, as a TO-220 on its lead shoulders; else the body's underside for a through-hole part and the lowest contacts for a surface-mount one.
- `pcbjs model check [entry...]` lists every footprint with its model source, `file`, `generated` with its kind, `no model` for a part drawn as the 3D view's outline, or `no body`, ends with the count of each, and flags files that are missing, do not read, or sit wrong as the outline above says, each with the command that fixes it. A part whose fetched model did not download is flagged with `pcbjs model fetch`. The last line counts the standard library's parts by fetched model, generated body, no body and waiting for a fetch. It exits with 1 when it flags any.

STEP files from vendor sites often come in inches, or with the origin at a corner of the body or at pin 1 rather than the footprint centre, or drawn lying on a side. `align` fixes all three: the unit becomes a `scale`, the corner origin an `offset`, the side a `rotate`. A confidence under 0.5, or a note that another turn fits as well, means a symmetric pin pattern or a model without distinct pins, such as an LGA or QFN: look at the shot and check pin 1.

Where to find models, as checked from a script in October 2026:

- KiCad's library, `gitlab.com/kicad/libraries/kicad-packages3D`, raw files with no login, STEP and WRL for every KiCad footprint. A KiCad model of the same land pattern as a standard library part usually fits with no transform.
- LCSC's EasyEDA library through `lcsc:<C-number>`, with no login; it has many parts KiCad lacks.
- Hirose serves its models to a script from the document link of its product page, `https://www.hirose.com/en/product/p/<CL code>/documents?path=%2Fapi%2Fv1%2Fproducts%2F<CL code>%2Fdocuments%2Fmodel_3d_step%2Fcontent`: `pcbjs model add '<that url>'` fetches the zip; curl needs a full browser User-Agent. Its `Read me.pdf` forbids redistribution.
- Other maker sites mostly do not serve a script: JST asks for an email, Molex, Würth and GCT refuse scripted downloads, and Bosch, ST and TI ship no STEP of their own and link SnapEDA or Ultra Librarian. Download those in a browser and add the file.
- SnapEDA and Ultra Librarian need a free account. glTF and GLB from three.js tooling and some vendor viewers work as well; a model with Draco or meshopt compression must be exported again without it.

Licences differ. Manufacturer models usually allow use in your designs but not redistribution, KiCad's models are CC-BY-SA 4.0 with an exception that lets designs and generated files use them freely, and the EasyEDA, SnapEDA and Ultra Librarian terms apply to what you download there. `models/LICENSES.md` keeps where each file came from and the licence file its zip carried; check the terms before you publish a repository or a built site that carries the model, and gitignore a model you may not redistribute.
