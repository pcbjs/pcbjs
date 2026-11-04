# Render

The one render spec behind `pcbjs shot` and the session's `session/render`: a PNG of the 2D, 3D or schematic view with a one-line legend, without a browser.
Advanced. Read it to look at a board from a script or an agent; viewer.md has the interactive viewer, 3d.md the GLB the 3D view renders.

```sh
pcbjs shot --view 3d --select U1
pcbjs shot --view 2d --frame drc:clearance:7f3a12c09e41 --findings
pcbjs shot --view 3d --camera top --side B --layer copper --explode 0.5
```

## The spec

| Field | `shot` flag | Does |
| --- | --- | --- |
| `view` | `--view 2d\|3d\|sch` | the board from above, the board in 3D, the schematic; repeat the flag for several |
| `entry`, `target` | the entries | the board, and a target of a board with variants, the first by default |
| `camera` | `--camera` | 3D: `iso`, `top`, `bottom`, `front`, or a renderer camera object of `@pcbjs/renderer`, metres and y up; default `iso` |
| `frame` | `--frame <ref>` | fits the view to what a reference of refs.md names, a finding id, a net, a group path, or a box `x0,y0,x1,y1` in board mm |
| `margin` | `--margin <mm>` | around the framed box, default 1 mm, 5 mm in the schematic |
| `highlight` | `--highlight <ref>` | outlined and tinted in the theme's accent; the rest fades |
| `dim` | `--dim <0..1>` | how far the rest fades with a highlight, default 0.6 |
| `layers` | `--layer <name>` | only these layers or groups; in 2D the outline stays; by id, alias, or `copper`, `silk`, `mask`, `paste`, `courtyard`, `fab`, and in 3D `bodies`, `board`, `barrels`, `references` |
| `opacity` | `--opacity <group>=<0..1>` | a layer or group drawn translucent |
| `side` | `--side F\|B` | B puts the back on top in 2D, unmirrored, and turns the 3D board over left to right so back silk reads |
| `mirror` | `--mirror` | the image mirrored left to right, labels upright |
| `explode` | `--explode <0..1>` | the 3D stack apart, 4 mm per stack group at 1, as the viewer's |
| `theme` | `--theme light\|dark\|hc` | canvas, accent and finding colours; the schematic in its light or dark colours |
| `size` | `--size WxH` | pixels, default 1280 by 960, at most 4096 by 4096 |
| `quality` | `--quality <1..4>` | 3D supersampling, default 1 |
| `findings` | `--findings [id]` | rings findings: every error and warning, or the ids and rule names given |
| `marks` | `--mark <json>` | markers, rings, lines and labels in board mm |

`--select <ref>` is `frame` and `highlight` on one reference, one shot per `--select`. Every other flag applies to every shot of the run. The schematic takes `frame`, `margin`, `highlight`, `dim`, `theme` and `size`; the board side, layers, explode and marks do not apply to it.

## Cameras

The presets look from the target toward these directions in the GLB's frame, x right, y up, z toward the board's bottom edge: `iso` from `[0.55, 0.9, 0.95]` in perspective, the viewer's iso view; `top` straight down and `bottom` straight up, orthographic; `front` from `[0, 0.25, 1]`. A frame fits the camera to the union of the parts' and nets' meshes, the copper items' outer faces and the target's box, grown by the margin; without one it fits the visible board.

## Marks

A mark is `{ type, at: [x, y], to?, text?, layer?, color?, radius?, depth? }`, `type` one of `marker`, `ring`, `line` with `to`, `label` with `text`. It sits on the outer face of its layer, `F.Cu` by default, and moves with that layer's stack group when exploded. It is depth tested on a side facing the camera, mask and silk let through, and always drawn when its layer is inner or faces away; `depth: 'always'` or `'test'` overrides. Labels are Hershey Simplex over a halo of the canvas colour.

A finding named by `--findings`, framed or highlighted becomes a ring at its position in red for an error, amber for a warning, its witness segments as lines, its points as markers, and its rule as a label.

## Output

A PNG with `tEXt` chunks `Snapshot`, `Legend` and `Software`, and the legend printed beside the file:

```text
.pcbjs/shots/Blinky-3d-select-R1.png  1280x960  312 ms  Blinky 3d iso; snapshot k3x9q2ab.7; frame R1; blue: R1, the rest faded 60%
```

The legend names the board, view, camera, snapshot, frame, what each colour means, the layers, the explode and how many findings are ringed. Files are `<dir>/<board>[-<target slug>]-<view>[-<camera>][-explode60][-select-U1][-frame-…][-hl-…][-<layers>][-back][-mirror][-<theme>].png`, so shots with other options never overwrite each other; `-o` sets the folder, `.pcbjs/shots` by default.

## Where it renders

With a live session `shot` is a thin client: `session/boards` lists the boards, then one `session/render { spec }` per shot answers the PNG as base64 in the snapshot's envelope with `legend`, `width`, `height` and `ms`. Without one, or with `--fresh`, it compiles here and renders through the same code. It exits 1 when a board fails to compile or a shot fails.

3D renders through `@pcbjs/renderer`, a CPU rasteriser in WebAssembly, from the GLB of the `exports` stage and the selection geometry its copper nodes carry; 2D and the schematic draw the exporter's SVG markup and rasterise it with sharp. The renderer loads on the first 3D shot only.

The session keeps one renderer worker thread holding the current scene, uploaded once per snapshot and board. A shot for a newer snapshot of a project terminates a running one for an older snapshot and fails its queued ones as `CANCELLED`. A WebAssembly trap or a thread exit kills only the thread; the session starts another, uploads the scene again and tries the shot once more before failing it. The thread is replaced after 16 scenes or 1.5 GB of growth, since WebAssembly memory never shrinks; eight shots may wait, and one may take 60 s.

## Budget

A 3D shot of a small board at 1280 by 960 and quality 1 takes about half a second, a close-up through the translucent mask up to a second, a large board such as usb-hub about a second; quality 2 costs about three times as much. 2D and schematic shots take tens of milliseconds. Keep agent shots at quality 1 and raise `--quality` for pictures meant to be kept.
