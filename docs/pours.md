# Pours

Copper pours: how a `<zone>` or `pour()` fills, its thermal reliefs and island removal, and stitching vias from the fill with `stitch()`.
The `<zone>` props are in the element table of layout.md, the thermal and island rules in rules.md.

```tsx
{pour(GND, 'F.Cu', rect(60, 60))}
{pour(GND, 'B.Cu', rect(60, 60), { connect: 'solid', islands: { minArea: 1 } })}
{pour(VCC, 'F.Cu', rect(10, 8, 2, 2), { priority: 1, clearance: 0.3 })}
{stitch(GND, { pitch: 4, layers: ['F.Cu', 'B.Cu'], padClearance: 1.0, via: { drill: 0.3, size: 0.62 }, avoid: { silk: true } })}
<U1 at="15 10" thermal={{ 5: 'solid' }} />
```

```text
pour(net, layer, d, { clearance?, priority?, minWidth?, connect?, islands? }?)   // <zone />
```

## Fill

- The outline, inset by `edgeClearance`, less other nets' copper grown by the clearance between them, their holes grown by `holeClearance`, and keepouts that forbid pours.
- Highest `priority` fills first and clears the later pours of other nets.
- A min width pass then removes every neck narrower than `minWidth`.

## Thermal reliefs

The pour keeps `rules.thermal.gap` around each pad of its net and crosses it with `spokes` spokes `spokeWidth` wide, on the pad axes at `angle` 90 or between them at 45. rules.md has the values.

| Where | Values | Wins over |
| --- | --- | --- |
| pour `connect` | `'thermal'` default, `'solid'`, `'none'` clears the pad | |
| pad `thermal`, or a part's or footprint's `thermal` map by pad number or name | the same, or `{ angle: 45 }` | the pour |
| `rules={{ thermal: { angle: 45 } }}` on a part | angle of its pads | the rules' `angle` |

- `QFN` and `LQFP` exposed pads with their thermal vias and the `ESP32C3Mini1` ground pad are `'solid'`. Vias and tracks of the net always join solid.
- Fewer than `minSpokes` spokes reaching the fill tries the set turned 45 degrees and keeps the better, as KiCad. A spoke ending in another pad's spoke is kept.
- Too few spokes is the DRC warning `thermal-spokes`; a track or via of the net joining the pad on the layer counts as a spoke, and a tht pad joined by another pour of its net is not flagged. A pad no spoke reaches is `unconnected`.
- A wrong pad in a placement's `thermal` map is a compile error.

## Islands

A fill piece that no pad or via of its net joins on its layer is dropped after the min width pass, as KiCad does.

| `islands` on the pour or in rules | Effect |
| --- | --- |
| `'remove'` | default |
| `'keep'` | keeps every piece |
| `{ minArea }` | drops pieces under that many mm² |

- `pcbjs inspect <net>` prints a `zone` row per layer: fill area, pieces and islands removed, `zones` in `--json`; the model counts `islandsRemoved`.
- Each fill piece is its own connectivity node, also in the Gerber self check: a pad in a cut-off piece is `unconnected`, naming pieces by layer, centroid and area.

## Stitching vias

`stitch()`, or `<stitch>`, is a child of `<PCB>` placing vias of a net where its pours overlap, after they fill.

```text
stitch(net, { pitch?, layers?, padClearance?, via?, avoid?, area?, grid?, origin? }?)   // or stitch(props) with net
```

| Option | Default | Meaning |
| --- | --- | --- |
| `pitch` | 4 | lattice step in mm from the board corner; a blocked point moves up to half the pitch |
| `layers` | every copper layer | each must have fill of the net under the whole via |
| `padClearance` | rules' `clearance` | from every pad's copper, its own net's too |
| `via` | rules' default via | `{ drill, size }`; through vias |
| `avoid` | none | `{ silk: true }` keeps `silkToPad` off silk; `{ courtyard: true }` keeps out of every courtyard |
| `area` | the board | an SVG path limiting the vias |
| `grid`, `origin` | none, board corner or `0 0` with `grid` | snap to an owner's via grid, `stitch(GND, { pitch: 5, grid: 0.635, origin: '0 0' })` |

- Each via keeps DRC clearance to other nets on every layer, `holeClearance` and `minHoleToHole` to holes, `edgeClearance`, and keepouts that forbid vias.
- Existing vias and tht pads of the net suppress lattice points within the pitch.
- Silk refs are placed afterwards and may land on a via; vias are tented.
- Only pours a via changes refill: other nets clear it, its own net joins solid.
- No via placed is the info finding `stitch-empty` with the reason. Calls place in document order, each seeing the ones before. Removed islands do not come back.
- `pcbjs inspect <net>` lists them as route `stitch` with the count and the 95th percentile nearest-neighbour distance.
