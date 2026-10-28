# Python constructs and their pcbjs form

| Python | pcbjs |
| --- | --- |
| `netlist.py`: a dict of nets to pins, per connector helpers | `nets()` and `.connect({ … })` in `pcb.sch.ts`; a helper per connector type stays a function returning the connect map |
| net classes and widths | `nets({ VBUS: { class: 'power' } })` and `classes` on `<PCB>` |
| `placement.py`: named constants, rows, columns, a port offset | a module of `export const` numbers both the board and the contracts import; positions as template strings, `` at={`${X0 + i * PITCH} ${Y}`} `` |
| loops placing repeated parts | `.map()` over an array, each block named with `group()`; `.ref()` when refs must not move |
| `routes.py`: corner tables, pad-relative moves | `route(U1[3]).h(1.2).V(Y_BUS).via('B.Cu').Z(J1[4])` chains; a lane helper for a bus |
| junction vias placed by name | `const V1 = via(NET, 'x y')` and routes that end at it |
| `legend.py`, `silk_*.py`: computed labels and rings | loops of `<text>` and `<path>` computed the same way; `font="newstroke"` at KiCad's size for KiCad's glyphs |
| imported logos and knockout art | the importer's `pcb.art.tsx` kept as data |
| `lib/rules.py` profiles | `rules` on `<PCB>`, a house rule module, or `variants()` for several fabs |
| `.kicad_dru` written by the generator | part, pad, net and class overrides, clearance by kind |
| a no-BOM or DNP list | `bom: false`, `pos: false`, `dnp: true` on the part |
| order notes for the fab | `fabNotes` on `<PCB>` or the preset |
| `assert` in `layout.py` | a DRC rule, else a contract over `pcbjs inspect --json` |
| `check_tracks.py` style checks | a contract over `inspect net:<n> --json` tracks |
| `check_system.py` across boards | `reference()` with `mate` and `nets` |
| `pkg3d.py --check` | `pcbjs model check` |
| `make preview`, `render3d` | `pcbjs shot --view both`, `--flip`, `--layer` |
| `board_info.py --text` for agents | `pcbjs inspect` |
| a git hash in the silk | `` {`V${version} | ${process.env.GIT_SHORT ?? 'DEV'}`} `` with `thicken` on outline fonts |
| panels, assembly drawings | not in pcbjs; keep the Python target for them |

## A route table as chains

```tsx
import PCB from '@pcbjs/fab/JLCPCB/2-Layer'
import { nets, route } from '@pcbjs/core'
import { PinHeader } from '@pcbjs/lib'

const LINES = ['L1', 'L2', 'L3'] as const
const N = nets()
const J1 = PinHeader(3).connect(N.L1, N.L2, N.L3)
const J2 = PinHeader(3).connect(N.L1, N.L2, N.L3)

// x where each line jogs down, from the generator's table, mm; the top line jogs last so none cross
const JOG = { L1: 16, L2: 13, L3: 10 }
const DROP = 4

export default (
  <PCB name="Table">
    <rect layer="Edge.Cuts" x={0} y={0} w={30} h={15} />
    <J1 at="3 3" />
    <J2 at="25 7" />
    {LINES.map((n, i) => route(J1[i + 1]).H(JOG[n]).v(DROP).Z(J2[i + 1]).width(0.4))}
  </PCB>
)
```

## Comparing as you go

Every rewrite step must keep the netlist comparison at 0 differences against the generated board. When a step changes copper on purpose, list the change with its reason so the comparison subtracts it; see the pcbjs-best-practices and pcbjs-port-from-kicad skills.
