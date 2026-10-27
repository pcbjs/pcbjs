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

Every answer starts with the board, its frame, outline and copper layers; several share those lines, each under `== <query>`, `--json` then `{ frame, results }`, and one for both a part and a net is `{ frame, query, part, net }`. A bare `--lengths`, or `--layer`, makes each query a filter. Coordinates are absolute board mm after every rotation and flip, pad sizes too, `footprintSize` in `--json` the footprint's. A round drill prints its diameter, a slot its extent in board x and y, `drill 1.70 x 0.60 slot`. The part list has a `model` column and a closing `models` line, a part line `model <source>`, and `--json` `model` per footprint, the source being `file`, `generated`, `no model` or `no body` as 3d.md defines them. An unknown query or layer prints what exists and exits with code 1.

A net's first line ends with its copper per layer, `copper F.Cu 42.0 mm², B.Cu 45.0 mm²`: the union of its pads, tracks, vias, drawings and fill with every drill cut out, `copper: [{ layer, area }]` in `--json`. Then a `zone` row per layer with fill area, pieces, islands removed and zone ids, `zones: [{ layer, area, pieces, fill: [{ zone, area }], islandsRemoved: { count, area }, ids }]`; the vias of `stitch()` with route `stitch` and a line `stitch  24 vias, nearest neighbour 95th percentile 4.00 mm`, `stitch: { count, p95 }` in `--json`, see pours.md; tracks with width, length, ends and route; a pair's line, see pairs.md; `route route:4  length 28.67 with vias  target 28.57 to 28.67 ok  group DATA  pcb.tsx:66:28`; `unconnected  2 gaps: …` and a `route failed` line per failed leg. `--json` adds track points and drawings as `graphics`, each with `prims` when it holds an arc: `{ kind: 'line', from, to }` and `{ kind: 'arc', from, to, center, cw }`, `cw` clockwise on screen.

`--lengths` prints id, net, pair, length with via barrels, target, group, skew, tuned, status `ok`, `short`, `long`, `failed` or `-`, and source; targets are in length.md.

`--layer` takes any layer and prints a row per item: id, kind, ref, text, ink bounds with the stroke's half width, shape and source; a pad on mask or paste is its opening as the Gerbers draw it. `--json` gives each `bounds: { x: [min, max], y: [min, max] }`, a text its `strokes` with bounds and points or its outline font `glyphs`, a drawing its `paths` and `prims`.
