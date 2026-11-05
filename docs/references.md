# Board references

`reference()` brings another entry's board into this one as a mechanical reference: placed by a connector mate, an anchor or a quaternion pose, shown translucent in 3D and dashed in 2D, checked for collisions, never copper.
Advanced. Read it to design a board stack, a daughter board or a test jig against the board it meets.

## API

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { reference } from '@pcbjs/core'
import { PinSocket } from '@pcbjs/lib'

const J1 = PinSocket(10, { rows: 2 })('SSW-110-01-G-D')

export default (
  <PCB name="controller" rev="0.1.0">
    <path layer="Edge.Cuts" d="M 0 0 H 60 V 45 H 0 Z" />
    <J1 at="8 33.86 180deg" side="B" />
    {reference('../driver/pcb.tsx', {
      mate: { local: J1[19], remote: 'J1', pin: 1, nets: true },  // below the board, as J1 is on the back
      gap: 8.5,                                       // face to face, mm; default the local connector's height, else 8
      rotate: 180, offset: [0, 0, 0],                 // corrections after the mate
      show: { outline: 'Dwgs.User', bodies: true, opacity: 0.5, color: '#7fb2ff' },
    })}
    {reference('../jig/pcb.tsx', { at: [0, 0, -12], flip: true })}
  </PCB>
)
```

## Options

| Option | Meaning | Default |
| --- | --- | --- |
| path | relative to the calling file, as an import; an absolute path or `file:` URL as it is; any other a package's board, such as `@acme/power/boards/PowerModule`, read with no compile, library.md | |
| `pose` | complete 3D placement: `{ translation: [x, y, z], orientation: [qx, qy, qz, qw] }`; see the frame and composition contract below | |
| `mate.local` | a part, mating at `pin`, or a pin or pad handle naming its own pad | |
| `mate.remote`, `pin` | ref of the mating part on the other board and its pin, by number or name, or a named point of the other board, see below | `pin` 1 |
| `mate.nets` | check nets across the mate: `true` same names, `{ SDO: 'SDI' }` maps listed names, or a function such as `n => n.replace(/^GND_.*$/, 'GND')`; a value may be a list, `{ LBAK: ['LBAK', 'SDO'] }`, any of which may meet | off |
| `mate: [ … ]` | several pairs: the first places the board, every pair is checked and left out of `reference-collision`, a pair without `nets` takes the first's; `inspect --references` lists them under `also mates` | |
| `side` | `F` the other board lies over this board's top face, `B` under its bottom | the local part's side |
| `stack` | `coplanar`: in this board's plane, edge to edge, with no `side` | stacked |
| `gap` | this board's face to the other's near face, mm | the local part's `height`, 8.5 for `PinSocket` or `PinHeader`, else its generated model's height, else its model file's box top, else 8 |
| `rotate` | degrees counter-clockwise from the top, about the local pin, or the origin in the anchor form | 0 |
| `offset` | mm in this board's frame, x right, y down, z up, applied last | |
| `at: [x, y, z]` | anchor form: the other origin at x, y in the frame of the enclosing groups, its bottom face at z from this board's bottom face | |
| `flip` | anchor form: turned over about its y axis, top face at z | false |
| `show.outline` | 2D layer, `false` for none | `Dwgs.User` |
| `show.bodies`, `opacity`, `color` | parts in 3D; 0 to 1; tint | |

`reference()` is a child of `<PCB>` or a `<g>`, and may sit in a component or layout.

## Quaternion poses

Use `pose` for arbitrary orientations, including an upright camera connected by a flexible cable. It is independent of connector mating and does not invent a rigid mate for a flex connection. Scalar `rotate` and `flip` remain conveniences for existing placements.

```tsx
import PCB, { reference, type ReferencePose } from '@pcbjs/core'
import { twoLayer } from '@pcbjs/lib/stackups'

const thickness = 1.6
const orientation: ReferencePose['orientation'] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]

export default (
  <PCB name="Carrier" stackup={twoLayer({ thickness })}>
    <rect layer="Edge.Cuts" x={0} y={0} w={120} h={80} />
    {[[10, 0], [110, 0], [60, 62]].map(([x, y]) => reference('./camera.pcb.tsx', {
      pose: { translation: [x, -y, thickness + 20], orientation },
    }))}
  </PCB>
)
```

The complete camera source and configuration are in `examples/board-poses`. Its camera is centred on its optical axis, with a 20 × 20 mm outline and 0.8 mm thickness. This pose points its front normal toward carrier +Y and its local upper edge toward carrier +Z. Rear-face anchors are (10, 0), (110, 0) and (60, 62); the optical axes lie 20 mm above the carrier **top**, and the board spans 10–30 mm above that top.

| Contract | Meaning |
| --- | --- |
| Frame | Right-handed 3D frame, matching reference meshes: X = board X, Y = **negative board Y**, Z up. `at` and `offset` retain their existing board-Y-down convention. |
| Translation | Three finite lengths, in mm or explicit length units, in the enclosing group's 3D frame. Z is measured from the carrier bottom face; add carrier thickness for a top-relative height. |
| Orientation | Quaternion `[x, y, z, w]`, four finite numbers. Identity is `[0, 0, 0, 1]`. Nonzero quaternions are normalized; zero, missing or malformed values are errors. `q` and `-q` have the same normalized representation. |
| Pivot | The referenced board's local XY origin at its **bottom face**, before rotation. Translation places that point, not the lowest point of a tilted board. |
| Composition | For a mesh point `p = [boardX, -boardY, height]`, `pWorld = G · T(translation) · R(orientation) · p`. Rotate first, translate second, then apply enclosing groups `G`. Parent group mirroring remains part of `G`. There is no Euler rotation order. |
| Precedence | `pose` is exclusive with `mate`, `at`, `rotate`, `flip`, `offset`, `side`, `stack` and `gap`. `show` remains independent. Compose corrections into the pose instead of mixing placement forms. |
| Simple forms | `at: [x, y, z], rotate: a` equals translation `[x, -y, z]` and orientation `[0, 0, sin(a/2), cos(a/2)]`, with `a` in radians in that formula. `flip: true` alone equals orientation `[0, 1, 0, 0]` and translation Z increased by the referenced board's thickness, preserving the old top-face anchor. |

The compiled `anchor` records `{ kind: 'pose', pose }` with numeric millimetres and a normalized quaternion. The existing `transform` field remains the authoritative column-major 4 × 4 world matrix, including parent groups; viewers, mesh export and `compose()` consume that placement. Matrix translation indices are 12–14. No mesh is pre-rotated or regenerated for each instance. JSON inspection reports the input pose, world matrix, world front normal and assembly bounds. Inspection normals and bounds use **carrier X, Y, Z**, with Y down; the pose and matrix use the right-handed 3D frame.

## The mate

A pin frame sits at the mating pad on the part's face, x along the part's x, z out of the face; a back part's is turned over about y.

| Where | Placement |
| --- | --- |
| `side` F or B | the remote frame on the local one, turned over about the local pin's y, `gap` apart; on the side the part faces it is face to face, else the local frame first moves through the board, as for press-fit or pogo pins |
| `stack: 'coplanar'` | remote pin on local pin, x axes along each other, both bottom faces at z 0, no `gap` |

- Then `rotate` about the local pin, then `offset`.
- Pad centre meets pad centre, so lands placed differently, a socket's rows at 1.975 mm and a header's at 2.00, leave a difference for `offset`.
- A socket turned 180deg on the back mates a header half a turn round; `rotate: 180` fixes it and `reference-mate` says so.

## Named points

A board names the points another board mates with, so the other board need not know its refs. `<mate name="hdr" at="8 33.86 180" side="B" />` names a pose in the frame of its groups, side F by default; `name="hdr"` on a placement, `<J1 at="8 33.86" name="hdr" />`, names the part's origin, rotation and side. Names are unique on a board and carried in its board data as `mates`.

`mate: { local: J1[19], remote: 'hdr' }` puts the point's frame on the local pin's: the point mates at itself, so `pin` names only the local pin. A point on a part brings that part's pads to `reference-net` and `reference-mate`; a `<mate>` point has none. A name that is neither a ref nor a point is an error listing the points.

## Rules

| Rule | Severity | Fires when |
| --- | --- | --- |
| `reference-mate` | error | a remote connector pad lands more than 0.1 mm from every local pad; names the first missing pin, the count, and `rotate` when half a turn lands all |
| `reference-net` | error | with `mate.nets`, a landing remote pad has another net than the mapping wants; names both parts, pins and nets. A local net no remote pin meets counts when every remote pin landed. A pad with no net on either side is not checked |
| `reference-collision` | warning | a body or the slab of the other board reaches more than 0.1 mm into this slab or a body, using conservative vertical prisms; the mating pair is left out |

- Two or more references are also checked against each other: `strip #2's board reaches 1.60 mm into strip #1's board`, numbered when they share a name.
- A body is the Fab outline box at a height: the footprint's `height`, which always wins, else its model file's box top with `offset`, `rotate` and `scale`, else 0 for a bare hole, test pad or pogo target, else 1 mm. Mating parts that overlap never count.
- The box comes from `.pcbjs/models/<hash>.bin`; your own compile passes `CompileOptions.modelBox`, a function from a model spec to its box in the footprint frame.
- For tilted boards, all slab vertices and all eight body-box corners contribute to the projected XY silhouette and minimum/maximum Z. Collision checks use their extruded vertical prisms, so arbitrary tilts can produce conservative false positives. Holes and cutouts do not establish mechanical clearance. Bodies use the footprint Fab bounds and resolved height described above; model overhangs outside those declared bounds need separate mechanical verification. This is not mesh-to-mesh collision certification.

## What it shows

- 3D: slab, outer copper, silk and models as one translucent group, hidden by `References` in the layer list; the exploded view moves a stacked board with the parts of its side, 3d.md. The mesh is `.pcbjs/models/boards/<hash>.bin`, served at `/__pcbjs/model/boards/<hash>` and copied to `models/boards/<hash>.bin` by `pcbjs build`.
- 2D: outline, holes and the mating pads as rings, dashed on `show.outline`. Tilted slabs include their projected thickness; drills project as paths rather than unchanged circles or slots. Tilted body projections follow `show.bodies`.
- Reference copper, drills, BOM rows and placement records never enter the carrier's manufacturing output. Preview SVGs may show the dashed reference annotations. The header line names each reference, linked when the same site builds it.
- `pcbjs inspect --references`: entry, mate/anchor/pose, derived side or `coplanar`, gap and its source, rotation, origin, slab Z range, transformed assembly bounds, mesh, and body heights by source. A pose also prints its normalized quaternion and transformed front normal. `--json` includes `pose`, `normal`, `bounds` and `transform`; body heights remain their local physical height, not their tilted Z span.

## Compiling and caching

- The entry compiles in its own process with its own `pcb.config.*`, defaults, registry and route cache; nothing reaches this board's registry.
- The result is in `.pcbjs/cache/references/`, keyed on the content hash of its module graph, config, model files and nested references. A warm compile starts no process.
- Dev watches its files and recompiles the boards that reference it; on a workspace server those scopes go stale, see workspace.md.
- A reference already on the chain is an error, `a reference cycle: controller → driver → controller`, self included, found across processes and through cached boards. A chain longer than eight is an error. An entry is named by its directory when it is a `pcb.tsx`, else its file name.

## Example

examples/motor-stack: the controller sits on the driver with `mate: { local: J1[socketPin(V5)], remote: 'J1', pin: headerPin(V5), nets: true }, rotate: 180`, below because J1 is on the back, both naming nets from one `lib/nets.ts`; the jig holds the controller face up on pogo pins with `mate: { local: P[0], remote: 'TP1', pin: 1 }`, the pins' 16 mm as gap.
