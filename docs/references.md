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

- The path is relative to the file that holds the call, as an import is. An absolute path or a `file:` URL is taken as it is.
- `reference()` is a child of `<PCB>` or of a `<g>` like any element, and it can sit in a component or a layout.
- `mate.local` is the part of this board that mates: a part, which mates at `pin`, or a pin or pad handle, which names its own pad. `mate.remote` is the ref of the mating part on the other board and `pin` its pin, by number or name, default 1.
- `mate` may be a list of pairs when the boards meet at several connectors, `mate: [{ local: J3, remote: 'J1', pin: 1 }, { local: J4, remote: 'J2' }]`: the first pair places the board, every pair is checked by `reference-mate` and `reference-net`, and every pair's two parts are left out of `reference-collision`. A pair without its own `nets` takes the first pair's. `inspect references` names the other pairs under `also mates`.
- `mate.nets` checks the nets across the mate, off by default: `true` wants the same net name on both pads of every mating pin pair, an object such as `{ SDO: 'SDI' }` maps a local name to the remote one and leaves the names it does not list as they are, and a function maps a local name to the remote one, such as `n => n.replace(/^GND_.*$/, 'GND')` to fold every `GND_*` into `GND`. See `reference-net` below.
- A value of the object, or what the function returns, may be a list of remote names, `nets: { LBAK: ['LBAK', 'SDO'], GND_LT: 'GND' }`, and the local net may then meet any of them, as a loop-back link meets two.
- `stack` says where the other board lies: `above` this board's top face, `below` its bottom face, or `coplanar`, in its plane.
- `gap` is the distance from this board's face on that side to the other board's near face. It defaults to the local part's `height`, the 8.5 mm of a `PinSocket` or `PinHeader`, else the height of its generated model, else the top of its model file's box, else 8 mm.
- `rotate` is degrees counter-clockwise seen from the top, about the local pin after the mate, about the origin in the anchor form. `offset` is mm in this board's frame, x right, y down, z up, applied last.
- The anchor form puts the other board's origin at `at` x and y in the frame of the groups around the call, and its bottom face at z, measured from this board's bottom face. With `flip: true` it is turned over about its y axis, as a part goes to the back, and its top face lands at z.
- `show.outline` is the layer of the 2D drawing, `false` for none; `bodies: false` leaves its parts out of the 3D view; `opacity` is 0 to 1.

## The mate

Each part has a pin frame: at the mating pad on the face the part sits on, x along the part's x axis, z out of that face. A back part's frame is turned over about its y axis, as the 3D view and KiCad place it.

- `above` and `below`: the remote pin frame is put on the local one turned over about the local pin's y axis, so the two parts face each other, `gap` apart. When the stack is on the side the local part faces, a front part with `above` or a back part with `below`, the mate is face to face. On the other side the local frame first moves through the board to the other face, for a press-fit or pogo pin reached from below.
- `coplanar`: the remote pin is put on the local one in the plane, the two parts' x axes along each other, both boards' bottom faces at z 0; `gap` does not apply.
- Then `rotate` about the local pin and `offset`.
- The mate puts pad centre on pad centre, the pads as each footprint draws them, so two footprints whose lands sit differently about their pins, a socket's rows at 1.975 mm from the centre line and a header's at 2.00, leave the board off by the difference; `offset` puts it back.

A socket placed turned on the back, as the controller of examples/motor-stack places its 2 x 10 socket at 180deg, mates a header half a turn round; `rotate: 180` puts it back, and `reference-mate` says so when that is the fix.

## Rules

| Rule | Severity | Fires when |
| --- | --- | --- |
| `reference-mate` | error | a pad of the remote connector lands more than 0.1 mm from every pad of the local part; names the first pin that misses, how many miss, and `rotate` when half a turn would land them all |
| `reference-net` | error | with `mate.nets`, a local pad of the mating part has a net and the remote pad that lands on it has another than the mapping wants; names both parts, both pins and both nets. A local pad with a net that no remote pin meets counts too when every remote pin landed. A pad without a net on either side is a no-connect and is not checked |
| `reference-collision` | warning | a body or the slab of the other board reaches more than 0.1 mm into this board's slab or a part body, both as boxes; names both parts. The mating pair itself is left out |

With two or more references the check also runs between each pair of them, slab and bodies, so two strips that butt on a splice board are checked against each other: `strip #2's board reaches 1.60 mm into strip #1's board`, the references numbered in order when they share a board name.

A body is the part's box from its Fab outline and a height, on both boards. The height is the footprint's `height` when it sets one, else the top of its model file's box above the board face, the box `pcbjs model check` reads, its `offset`, `rotate` and `scale` applied, else 0 for a bare hole, a test pad or a pogo target, which then has no body, and 1 mm for any other part. A `height` on the footprint always wins over the model box, so set it only to override a model. The cli reads the box from the model cache, `.pcbjs/models/<hash>.bin`, converting a file it has not seen once, and the referenced board's child compile does the same in its own project. A compile of your own passes the loader as `CompileOptions.modelBox`, a function from a model spec to its box in the footprint frame. Mating parts that reach into each other are a mated pair and never count.

## What it shows

- 3D: the whole referenced board, slab, outer copper, silk and part models, as one translucent tinted group. The layer list has a `References` entry that hides it. The mesh is built in Node by the 3D view's own geometry code and part models, cached as `.pcbjs/models/boards/<hash>.bin`, served at `/__pcbjs/model/boards/<hash>` in dev and copied to `models/boards/<hash>.bin` by `pcbjs build`, as model files are, see 3d.md.
- 2D: its outline and holes, and the mating connector's pads as small rings, dashed on the layer `show.outline` names, `Dwgs.User` by default.
- Nothing in the board's items, the Gerbers, the drill files or the fab set.
- The board's header line names each reference, a link to the other board's page when the same site builds it.
- `pcbjs inspect references` lists each reference with its entry, anchor, stack, gap, rotation, where its origin goes, its slab's z range and its mesh, where the gap came from, and the body heights of both boards by source, `height`, `model box`, `default 1 mm` or `bare hole`, naming the parts that take a model box or the default.

## Compiling and caching

The referenced entry compiles in a process of its own, with its own `pcb.config.*`, defaults, schematic registry and route cache, found from the entry up to the nearest config. Nothing of it reaches this board's registry, so a part or net it shares through a `lib/` is never placed here.

- The result is kept in `.pcbjs/references/` of this project, keyed by the entry, with the content hash of every file of its module graph, its config, its model files and the graphs of the boards it references in turn. A warm compile reads the files, finds the hashes equal and takes the result without starting a process; a change to any of them compiles it again.
- The mesh is named by that hash, so repeated references to one board share it.
- The dev server watches the referenced board's files: an edit recompiles the boards that reference it. On a workspace server, see workspace.md, they belong to every scope that references the board, so an edit marks those scopes stale and they recompile when shown.

## Cycles and depth

A reference to an entry already on the compile chain is a compile error naming the cycle, `a reference cycle: controller → driver → controller`, an entry referencing itself included. The chain travels to each child process, so the cycle is found by the compile that closes it, and a cached board's own references are checked against the chain too. A chain longer than eight entries is an error too. An entry is named by its directory when it is a `pcb.tsx`, else by its file name.

## Example

examples/motor-stack: the controller references the driver below it, its 2 x 10 socket on the driver's header, with `mate: { local: J1[socketPin(V5)], remote: 'J1', pin: headerPin(V5), nets: true }, stack: 'below', rotate: 180`, both boards naming their header nets from one `lib/nets.ts`; the jig references the controller lying face up on its pogo pins, with `mate: { local: P[0], remote: 'TP1', pin: 1 }` and the pogo pin's 16 mm as the gap.
