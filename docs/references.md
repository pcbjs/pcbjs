# Board references

`reference()` brings another entry's board into this one as a mechanical reference: placed by a mating pair of connectors or by an anchor, shown translucent in 3D and dashed in 2D, checked for the mate and for collisions, never copper.
Read it to design a board stack, a daughter board or a test jig against the board it meets.

## API

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { reference } from '@pcbjs/core'
import { PinSocket } from '@pcbjs/lib'

const J1 = PinSocket(10, { rows: 2, value: 'SSW-110-01-G-D' })

export default (
  <PCB name="controller">
    <path layer="Edge.Cuts" d="M 0 0 H 60 V 45 H 0 Z" />
    <J1 at="8 33.86 180deg" side="B" />
    {reference('../driver/pcb.tsx', {
      mate: { local: J1[19], remote: 'J1', pin: 1, nets: true },  // local: a part, a pin handle, or a part of a group such as PORTS[2].J
      stack: 'below',                                 // 'above' | 'below' | 'coplanar'; default 'above'
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
| path | relative to the calling file, as an import; an absolute path or `file:` URL as it is | |
| `mate.local` | a part, mating at `pin`, or a pin or pad handle naming its own pad | |
| `mate.remote`, `pin` | ref of the mating part on the other board and its pin, by number or name | `pin` 1 |
| `mate.nets` | check nets across the mate: `true` same names, `{ SDO: 'SDI' }` maps listed names, or a function such as `n => n.replace(/^GND_.*$/, 'GND')`; a value may be a list, `{ LBAK: ['LBAK', 'SDO'] }`, any of which may meet | off |
| `mate: [ … ]` | several pairs: the first places the board, every pair is checked and left out of `reference-collision`, a pair without `nets` takes the first's; `inspect references` lists them under `also mates` | |
| `stack` | `above` this board's top face, `below` its bottom, `coplanar` in its plane | `above` |
| `gap` | this board's face to the other's near face, mm | the local part's `height`, 8.5 for `PinSocket` or `PinHeader`, else its generated model's height, else its model file's box top, else 8 |
| `rotate` | degrees counter-clockwise from the top, about the local pin, or the origin in the anchor form | 0 |
| `offset` | mm in this board's frame, x right, y down, z up, applied last | |
| `at: [x, y, z]` | anchor form: the other origin at x, y in the frame of the enclosing groups, its bottom face at z from this board's bottom face | |
| `flip` | anchor form: turned over about its y axis, top face at z | false |
| `show.outline` | 2D layer, `false` for none | `Dwgs.User` |
| `show.bodies`, `opacity`, `color` | parts in 3D; 0 to 1; tint | |

`reference()` is a child of `<PCB>` or a `<g>`, and may sit in a component or layout.

## The mate

A pin frame sits at the mating pad on the part's face, x along the part's x, z out of the face; a back part's is turned over about y.

| `stack` | Placement |
| --- | --- |
| `above`, `below` | the remote frame on the local one, turned over about the local pin's y, `gap` apart; on the side the part faces it is face to face, else the local frame first moves through the board, as for press-fit or pogo pins |
| `coplanar` | remote pin on local pin, x axes along each other, both bottom faces at z 0, no `gap` |

- Then `rotate` about the local pin, then `offset`.
- Pad centre meets pad centre, so lands placed differently, a socket's rows at 1.975 mm and a header's at 2.00, leave a difference for `offset`.
- A socket turned 180deg on the back mates a header half a turn round; `rotate: 180` fixes it and `reference-mate` says so.

## Rules

| Rule | Severity | Fires when |
| --- | --- | --- |
| `reference-mate` | error | a remote connector pad lands more than 0.1 mm from every local pad; names the first missing pin, the count, and `rotate` when half a turn lands all |
| `reference-net` | error | with `mate.nets`, a landing remote pad has another net than the mapping wants; names both parts, pins and nets. A local net no remote pin meets counts when every remote pin landed. A pad with no net on either side is not checked |
| `reference-collision` | warning | a body or the slab of the other board reaches more than 0.1 mm into this slab or a body, as boxes; the mating pair is left out |

- Two or more references are also checked against each other: `strip #2's board reaches 1.60 mm into strip #1's board`, numbered when they share a name.
- A body is the Fab outline box at a height: the footprint's `height`, which always wins, else its model file's box top with `offset`, `rotate` and `scale`, else 0 for a bare hole, test pad or pogo target, else 1 mm. Mating parts that overlap never count.
- The box comes from `.pcbjs/models/<hash>.bin`; your own compile passes `CompileOptions.modelBox`, a function from a model spec to its box in the footprint frame.

## What it shows

- 3D: slab, outer copper, silk and models as one translucent group, hidden by `References` in the layer list. The mesh is `.pcbjs/models/boards/<hash>.bin`, served at `/__pcbjs/model/boards/<hash>` and copied to `models/boards/<hash>.bin` by `pcbjs build`.
- 2D: outline, holes and the mating pads as rings, dashed on `show.outline`.
- Nothing in the items, Gerbers, drills or fab set. The header line names each reference, linked when the same site builds it.
- `pcbjs inspect references`: entry, anchor, stack, gap and its source, rotation, origin, slab z range, mesh, and both boards' body heights by source, `height`, `model box`, `default 1 mm` or `bare hole`.

## Compiling and caching

- The entry compiles in its own process with its own `pcb.config.*`, defaults, registry and route cache; nothing reaches this board's registry.
- The result is in `.pcbjs/references/`, keyed on the content hash of its module graph, config, model files and nested references. A warm compile starts no process.
- Dev watches its files and recompiles the boards that reference it; on a workspace server those scopes go stale, see workspace.md.
- A reference already on the chain is an error, `a reference cycle: controller → driver → controller`, self included, found across processes and through cached boards. A chain longer than eight is an error. An entry is named by its directory when it is a `pcb.tsx`, else its file name.

## Example

examples/motor-stack: the controller sits on the driver with `mate: { local: J1[socketPin(V5)], remote: 'J1', pin: headerPin(V5), nets: true }, stack: 'below', rotate: 180`, both naming nets from one `lib/nets.ts`; the jig holds the controller face up on pogo pins with `mate: { local: P[0], remote: 'TP1', pin: 1 }`, the pins' 16 mm as gap.
