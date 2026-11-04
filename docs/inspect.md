# Inspect

`pcbjs inspect`: where parts, pads, nets, routes and layer items ended up, in absolute mm, as text or `--json`, from one compile or a live session.
Advanced. Every other command and flag is in cli.md; reading `pcbjs check` in check.md.

```
pcbjs inspect              every footprint with its path, value, at, rot, side, pads, source
pcbjs inspect D1           one part and its pads; by tree path as CH2/R01
pcbjs inspect J1/2         one pad, by number or name; CH2/R01/1 inside an instance
pcbjs inspect CH2          the parts of an instance or a named <g>
pcbjs inspect GND          one net: pads, zones, vias, tracks, pairs, routes, gaps, failures
pcbjs inspect net:D3       the net D3 only; a bare D3 that is a part and a net prints both
pcbjs inspect route:3      a route: its row of --lengths, points, legs, tracks and vias; route:3/pt:2, route:3/leg:1 one of them
pcbjs inspect item:0a1b2c3d4e5f   one item by its uid; pair:1, span:F.Cu..B.Cu, plane:B.Cu:GND as well
pcbjs inspect drc:short:5be0c3d1a2f4   one finding by the id check printed, with its fingerprint
pcbjs inspect --lengths D  every route, or those of one net, pair or match group
pcbjs inspect --layer F.SilkS [U1]  every item on the layer, or those of a part or net
pcbjs inspect --references  each reference(), see references.md
pcbjs inspect --sch         the schematic drawing: symbols, wires, labels, see schematic-graphic.md
pcbjs inspect --grids       each grid: pitch, subdivisions, origin, angle, frame, what is on it, see grids.md
pcbjs inspect U1 GND J1/3 --lengths DATA   several answers from one compile
```

## Output

- Every answer starts with the board, frame, outline and copper layers; several queries share them, each under `== <query>`. `--json` is `{ frame, results }` for several queries.
- `--json` gives the records of `pcbjs q`, queries.md, beside the frame: the part list `{ parts, models }`, a part `{ part, graphics }`, a pad `{ pad }`, a group `{ group, parts }`, a route `{ route, legs, tracks, vias }`, `--lengths` `{ routes }`, an item `{ item }`, a pair `{ pair, routes }`, a point or leg `{ pt }` or `{ leg }`, a finding `{ finding }`, a span `{ span, vias }`, a plane `{ plane, zones, regions }`, a region `{ region }`. A name that is a part and a net gives the net answer under `net`.
- A query is any reference of refs.md, `board:` and all; a bare name that is no part, group or instance may name a net. A bare `--lengths` or `--layer` makes each query a filter. An unknown query or layer prints why, the refs and the nets, and exits 1.
- Pads, tracks, vias, zones and layer items print their uid beside the numeric `#id` of the compile; an item record has both as `ref` and `id`, a pad record its `uid`. A zone row lists `#id uid` per pour and `region:` hashes under a `plane:` query.
- Coordinates and pad sizes are absolute board mm after rotation and flip, to 0.1 µm in `--json`; a pad's `footprintSize` and `footprintDrill` are the footprint's.
- A round drill prints its diameter, a slot its board extent: `drill 1.70 x 0.60 slot`.
- The part list has a `model` column and a closing `models` line; a part line `model <source>`, the record `model`: `file`, `generated`, `no model` or `no body`, 3d.md.

## A net

| Line | Text | `--json` |
| --- | --- | --- |
| first | ends `copper F.Cu 42.0 mm², B.Cu 45.0 mm²`, pads, tracks, vias, drawings and fill less drills | `net`, the net record; `copper: [{ layer, area }]` |
| `zone` | per layer: fill area, pieces, islands removed, zone ids | `zones: [{ layer, area, pieces, fill: [{ zone, area }], islandsRemoved: { count, area }, ids, uids }]` |
| `stitch` | `stitch  24 vias, nearest neighbour 95th percentile 4.00 mm`, the vias with route `stitch`, pours.md | `stitch: { count, p95 }`, each via `stitch: true` |
| pads, vias, tracks | the tables of a part, a route and a span | `pads`, `vias`, `tracks` as records |
| pair | pairs.md | `pairs`, each with its `tracks` |
| `route` | `route route:4  length 28.67 with vias  target 28.57 to 28.67 ok  group DATA  pcb.tsx:66:28` | `routes`, those of no pair |
| gaps | `unconnected  2 gaps: …`, a `route failed` line per failed leg | `unconnected`, `failed` |

`--json` adds drawings as `graphics`. A track or drawing record has `prims` when one holds an arc: `{ kind: 'line', from, to }`, `{ kind: 'arc', from, to, center, cw }`, `cw` clockwise on screen.

## `--lengths`

Columns: route, `route:vccTrunk` for a bound route, else `route:<n>` by its place in the PCB tree; net, pair, length with via barrels, target, group, skew, tuned, status `ok`, `short`, `long`, `failed` or `-` for no target, source. Rows follow the PCB tree: each route that laid copper or failed. The record's `target` is `{ min, max }`, narrowed by the match group, `max` null for none, and its `status` `ok` for no target. Targets are in length.md.

## `--layer`

A row per item: id, uid, kind, ref, text, ink bounds with the stroke's half width, shape, source, the part's for an item it drew. A pad on mask or paste is its opening as the Gerbers draw it. `--json` gives each item record with `bounds: { x, y, w, h }` of that ink, `summary`, the shape column, and a pad's `rings`; a text record has its `strokes` or outline font `glyphs`, a drawing's its `paths` and `prims`.
