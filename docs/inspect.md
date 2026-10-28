# Inspect

`pcbjs inspect`: where parts, pads, nets, routes and layer items ended up, in absolute mm, as text or `--json`, from one compile or a running dev server.
Every other command and flag is in cli.md.

```
pcbjs inspect              every footprint with its path, value, at, rot, side, pads, source
pcbjs inspect D1           one part and its pads; by instance path as CH2/R or CH2.R
pcbjs inspect J1.2         one pad, by number or name
pcbjs inspect GND          one net: pads, zones, vias, tracks, pairs, routes, gaps, failures
pcbjs inspect net:D3       the net D3 only, part:D3 the part; a bare D3 prints both
pcbjs inspect --lengths D  every route, or those of one net, pair or match group
pcbjs inspect --layer F.SilkS [U1]  every item on the layer, or those of a part or net
pcbjs inspect references   each reference(), see references.md
pcbjs inspect sch          the schematic drawing: symbols, wires, labels, see schematic-graphic.md
pcbjs inspect U1 GND J1.3 --lengths DATA   several answers from one compile
```

## Output

- Every answer starts with the board, frame, outline and copper layers; several queries share them, each under `== <query>`. `--json` is `{ frame, results }`, or `{ frame, query, part, net }` for a name that is both.
- A bare `--lengths` or `--layer` makes each query a filter. An unknown query or layer prints what exists and exits 1.
- Coordinates and pad sizes are absolute board mm after rotation and flip; `footprintSize` in `--json` is the footprint's.
- A round drill prints its diameter, a slot its board extent: `drill 1.70 x 0.60 slot`.
- The part list has a `model` column and a closing `models` line; a part line `model <source>`, `--json` `model`: `file`, `generated`, `no model` or `no body`, 3d.md.

## A net

| Line | Text | `--json` |
| --- | --- | --- |
| first | ends `copper F.Cu 42.0 mm², B.Cu 45.0 mm²`, pads, tracks, vias, drawings and fill less drills | `copper: [{ layer, area }]` |
| `zone` | per layer: fill area, pieces, islands removed, zone ids | `zones: [{ layer, area, pieces, fill: [{ zone, area }], islandsRemoved: { count, area }, ids }]` |
| `stitch` | `stitch  24 vias, nearest neighbour 95th percentile 4.00 mm`, the vias with route `stitch`, pours.md | `stitch: { count, p95 }` |
| tracks | width, length, ends, route | track points |
| pair | pairs.md | |
| `route` | `route route:4  length 28.67 with vias  target 28.57 to 28.67 ok  group DATA  pcb.tsx:66:28` | |
| gaps | `unconnected  2 gaps: …`, a `route failed` line per failed leg | |

`--json` adds drawings as `graphics`, with `prims` when one holds an arc: `{ kind: 'line', from, to }`, `{ kind: 'arc', from, to, center, cw }`, `cw` clockwise on screen.

## `--lengths`

Columns: id, net, pair, length with via barrels, target, group, skew, tuned, status `ok`, `short`, `long`, `failed` or `-`, source. Targets are in length.md.

## `--layer`

A row per item: id, kind, ref, text, ink bounds with the stroke's half width, shape, source. A pad on mask or paste is its opening as the Gerbers draw it. `--json` gives `bounds: { x: [min, max], y: [min, max] }`, a text's `strokes` with bounds and points or its outline font `glyphs`, a drawing's `paths` and `prims`.
