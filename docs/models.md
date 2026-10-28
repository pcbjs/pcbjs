# Model files from vendors

`pcbjs model add`, `align` and `check`: fetch a STEP, glTF or WRL model, fit it to a placed part, write the `model` option, and where to find models and what their licences allow.
The model descriptor, its frame and the mesh cache are in 3d.md.

```sh
pcbjs model add https://example.com/JK0654219NL.stp --ref J1 --write
pcbjs model add lcsc:C965555 --ref D2 --write
pcbjs model add --ref D2 --write        # the part's MPN:LCSC number
pcbjs model align J1
pcbjs model check
pcbjs shot --view 3d --select J1
```

Stdlib parts fetch their own models, see 3d.md Fetched on first use; `pcbjs model fetch` gets them at once.

## model add

`pcbjs model add <file-or-url> [--ref J1 | --footprint <id>] [--entry <board>] [--as <name>] [--write] [--force]`

| Flag | Effect |
| --- | --- |
| `<file-or-url>` | copied or downloaded into `models/`; a zip is unpacked to its first model file |
| `lcsc:<C-number>` | EasyEDA's model of the LCSC part, no login |
| `--ref` | fits to that placed part as align does and prints the `model` option; alone, uses the part's `MPN:LCSC` number |
| `--footprint <id>` | fits to the first part with that footprint; `--write` goes on the `<footprint>` element found by `id`, so every part of it gets it |
| `--write` | writes the option into the code, the path relative to that file |
| `--entry` | the board, when a ref is on several; or `--ref Sense/SW1` by board name, entry or folder |
| `--as`, `--force` | file name; overwrite |

- It prints the model's box in mm and unit guess and appends source and date to `models/LICENSES.md`; a licence in the zip, such as Hirose's `Read me.pdf`, is saved as `<model>-<file>`.
- `--write` takes the options form: `R0603('10k')` becomes `R0603({ value: '10k', model })`, `F('10k', { MPN })` becomes `F({ value: '10k', source: { MPN }, model })`.
- Without a board for a shared ref, such as `--entry sense.tsx`, add and align refuse and list the boards.

## model align

`pcbjs model align [entry] <ref> [--file <model>]` prints `offset`, `rotate`, `scale`, the pins matched, a confidence from 0 to 1 and the `shot` command.

- The unit comes from the courtyard; of the 24 ways to stand and turn the model it keeps the one with most pins on pads, as drawn unless the pins clearly disagree, or by `height` without pins.
- It keeps what fits: the part's transform, such as KiCad's `(model ...)` line, and the file's own frame stay when they land as many pins. A new fit snaps to 0, the pad pitch or half of it within 0.1 mm.
- The seat is the file's z = 0 when the model sits on it, or a through-hole part's pins pass it under a standoff body such as TO-220; else the body underside for through-hole and the lowest contacts for SMD.
- Inches, a corner or pin 1 origin, and a model on its side become `scale`, `offset` and `rotate`. Confidence under 0.5 or an equal turn means symmetric pins such as LGA or QFN: check pin 1 in the shot.

## model check

`pcbjs model check [entry...]` lists every footprint's model source: `file`, `generated` with its kind, `no model` or `no body`, with counts. It flags missing, unreadable or misplaced files, and parts waiting on `pcbjs model fetch`, each with its fix, and counts the stdlib's parts by fetched, generated, no body and waiting. Exits 1 when it flags any.

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
