# Pours

Copper pours: how a `<zone>` or `pour()` fills, its thermal reliefs and island removal, and stitching vias from the fill with `stitch()`.
The `<zone>` props are in the element table of layout.md, the thermal and island rules in rules.md.

## Fill

A pour fills its outline inside `edgeClearance` of the board edge, less the copper of other nets grown by the clearance that holds between the pour and each item, the holes of other nets grown by `holeClearance`, and the hard keepouts that forbid pours. Pours fill highest `priority` first, and each clears the fill of the pours of other nets filled before it. A min width pass then removes every neck narrower than `minWidth`.

```text
pour(net, layer, d, { clearance?, priority?, minWidth?, connect?, islands? }?)   // <zone />
```

```tsx
{pour(GND, 'B.Cu', rect(30, 20))}
{pour(VCC, 'F.Cu', rect(10, 8, 2, 2), { priority: 1, clearance: 0.3 })}
```

## Thermal reliefs

A pour joins the pads of its net through thermal reliefs, KiCad's default. The pour keeps `rules.thermal.gap` clear around the pad, and `spokes` spokes `spokeWidth` wide cross the gap into the fill, along the pad's axes with `angle` 90 or between them with 45. Each spoke is cut to what the pour may cover and kept only where it reaches the fill; it is part of the fill everywhere. The rules are in rules.md.

- `connect` on a pour: `'thermal'`, the default, `'solid'` pours over the pads as before, `'none'` clears them like a pad of another net.
- `thermal` on a pad, or a placed part's or footprint's `thermal` map of pad number or name, wins over the pour: `'solid'` for thermal vias and heat slugs. `{ angle: 45 }` there, or `rules={{ thermal: { angle: 45 } }}` on a part, turns that pad's spokes over the rules' `angle`, as KiCad does on round pads.
- The exposed pad of `QFN` and `LQFP`, its thermal vias and the ground pad of `ESP32C3Mini1` are `'solid'`. Vias and tracks of the net always join solidly.
- When fewer than `minSpokes` spokes of the set reach the fill, as on a header pin between its neighbours and the board edge, the set turned by 45 degrees is tried and the better one kept, as KiCad does. A spoke whose end lies in a spoke of another pad of the pour is kept too, as KiCad's filler keeps it.
- A pad that still only a few spokes reach is the DRC warning `thermal-spokes`; a track or via of its net that joins it on the pour's layer counts as a spoke, as in KiCad. No warning either for a through-hole pad that another pour of its net joins solidly or through enough spokes; one that no spoke reaches is not joined to the pour, and `unconnected` reports it. Dense layouts with fine-pitch pads may need `'solid'` or a smaller gap.
- A wrong pad in a placement's `thermal` map is a compile error at the placement.

```tsx
{pour(GND, 'F.Cu', rect(30, 20))}
{pour(GND, 'B.Cu', rect(30, 20), { connect: 'solid' })}
<U1 at="15 10" thermal={{ 5: 'solid' }} />
```

## Islands

A pour drops every fill piece that its layer's copper does not join to a pad or via of its net, as KiCad does by default, after its min width pass has cut necks narrower than `minWidth`, those between two keepouts included: floating copper between fine-pitch pins, a piece only a dangling track touches, or a pour with nothing of its net. `islands` on the pour, or in the rules, is `'remove'`, the default, `'keep'`, or `{ minArea }` to drop only pieces under that many mm². `pcbjs inspect <net>` prints a `zone` row per layer with the fill area in mm², the fill pieces and the islands removed, `zones` in `--json`; the zone's `islandsRemoved` counts them in the model.

Each fill piece is its own node of connectivity, here and in the Gerber self check: a pad in a piece other copper cuts off is `unconnected`, and the finding names the pieces by layer, centroid and area. A stitching via or a short track joins it.

```tsx
{pour(GND, 'B.Cu', rect(30, 20), { islands: { minArea: 1 } })}
```

## Stitching vias

`stitch()` places vias of a net where its pours overlap, at compile time, after the pours fill. It is a child of `<PCB>` like `pour()`, and `<stitch>` is the same element.

```text
stitch(net, { pitch?, layers?, padClearance?, via?, avoid?, area?, grid?, origin? }?)   // <stitch />
stitch(props)                                                         // the object form, with net
```

```tsx
{pour(GND, 'F.Cu', rect(60, 60))}
{pour(GND, 'B.Cu', rect(60, 60))}
{stitch(GND, { pitch: 4, layers: ['F.Cu', 'B.Cu'], padClearance: 1.0, via: { drill: 0.3, size: 0.62 }, avoid: { silk: true } })}
```

- A via goes on each point of a lattice `pitch` apart, default 4 mm, anchored to the board's corner, where every one of `layers`, default every copper layer, has fill of the net under the whole via. A point that is blocked takes the nearest free spot within half the pitch, at least half the pitch from every via of the net.
- The via keeps the clearance the DRC holds to every other-net item on every layer it passes, `holeClearance` and `minHoleToHole` to every hole, `edgeClearance` to the edge, and out of keepouts that forbid vias.
- `padClearance`, default the rules' `clearance`, keeps it that far off the copper of every pad, its own net's too.
- `avoid: { silk: true }` keeps it `silkToPad` off silkscreen graphics and text. The silk refs are placed afterwards and do not avoid vias, so a ref may still land on one; vias are tented.
- `avoid: { courtyard: true }` keeps the whole via out of every part's courtyard on either side, so no via lands under a part. It is off by default.
- `grid` and `origin` put every via on an owner's via grid: `stitch(GND, { pitch: 5, grid: 0.635, origin: '0 0' })` starts the lattice at `origin`, snaps each lattice point to the grid and moves a blocked point in steps of `grid`. `origin` defaults to the board corner, or `0 0` with `grid`.
- `area`, an SVG path, limits the vias to its closed areas.
- `via` gives `drill` and `size`, default the rules' default via. The vias are through vias.
- A via of the net already on the board, hand placed or routed, or a through-hole pad of the net, suppresses every lattice point within the pitch, so stitching adds to a layout instead of crowding it.
- After placing, only the pours a via changes refill, with every lower priority pour that overlaps them: another net's pour whose fill comes within its clearance of a via, as on an inner layer, clears the vias; a via of the net joins its pours solidly and leaves their fill as it was, since a pour does not cut its own net's drills.
- A call that places no via gives the info finding `stitch-empty` with the reason.
- The vias carry the net and count like any via in connectivity, DRC, the Gerbers and the drill file. Several `stitch()` calls place in document order, each seeing the vias of the ones before.
- Stitching does not bring back an island the pour already removed: it places vias only in fill that survived the island pass.
- `pcbjs inspect <net>` lists them as route `stitch` and prints the count and the 95th percentile of the distance from each stitching via to its nearest neighbour among them.
