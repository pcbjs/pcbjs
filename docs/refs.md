# References

The one way every surface names a part, pad, net, route, item or finding: a slash path of tree names and typed `kind:value` segments.
Advanced. `pcbjs check` and `pcbjs inspect` print them, `inspect` takes any of them, findings carry them; findings.md has the ids findings get.

```
ref   = seg *( "/" seg )
seg   = typed / name
typed = kind ":" value
kind  = "board" / "net" / "route" / "leg" / "pt" / "pair" / "drc" / "erc" / "item" / "span" / "plane" / "region" / "panel"
name  = 1*( ALPHA / DIGIT / "_" / "-" / "." / "+" )
; a tree path ends in names, or in one route: with its leg: or pt:
```

## Tree names

| Reference | Names |
| --- | --- |
| `R1` | the part R1 |
| `R1/2`, `U1/PA9` | a pad of a part, by number first, then by pin name |
| `CH2`, `Power` | a circuit instance or a named `<g>` and the parts under it |
| `CH2/R01`, `R201` | one part: the instance path and the ref the compiler made of it, as silk and the BOM print it |
| `Power/CH2/R01/2` | a pad under a full tree path |

- A bare name is a part ref first, then a named `<g>` or an instance anywhere, then a local name inside an instance. Several matches are an error that lists each full path, `R01 names several: CH1/R01, CH2/R01`.
- Any unique tail of a full path resolves, so `CH2/R01` finds `Power/CH2/R01`.
- In code a pad is the handle `U1[3]` or `U1.G`, and a reference names it `U1/3`.

## Typed segments

| Reference | Names |
| --- | --- |
| `net:VCC`, `net:P1/CC1` | a net; a name made with `nets('P1')` keeps its slash |
| `route:3`, `route:vccTrunk` | a route: bound ones by their binding, the others by their place in the PCB tree over every route, bound ones counted |
| `CH2/route:vccTrunk` | a route a circuit build returns, under its instance path, the handle `ch2.vccTrunk` |
| `route:3/leg:2` | the second automatic leg of the route, in chain order |
| `route:vccTrunk/pt:2`, `CH2/route:vccTrunk/pt:2` | `pt:0` the start, `pt:k` where the k-th chain call ends; in code `vccTrunk.pt(2)`, `.start` and `.end`, routing.md Route points |
| `pair:1` | a differential pair as the router laid it out |
| `item:0123456789ab`, `item:0123456789ab~2` | one copper, drawing or text item by its uid |
| `drc:clearance:0123456789ab`, `erc:single-pin-net:0123456789ab` | a finding of one compile by its exact id |
| `span:F.Cu..In2.Cu`, `net:GND/span:F.Cu..In1.Cu` | the vias between two layers, of every net or of one |
| `plane:In1.Cu:GND` | a net's pours on one layer |
| `plane:In1.Cu:GND/region:<hash>` | one fill piece, by the hash of its outline that `inspect` prints |
| `panel:Main/B3/U1` | a part of a board instance of a panel, for panels to come |

- A leading `board:<name>` makes a reference absolute, `board:Blinky/R1/2`; a command that already names the board leaves it out. Alone it names the board, whose `<PCB` an editor jump opens. A variant target is never part of a reference; a finding carries it as a field.
- A bound route answers only to its name: `route:3` does not name it, so binding one renumbers no other.
- A tree path holds one typed segment, a route of an instance, `CH2/route:vccTrunk`; any unique tail resolves, so `route:vccTrunk` finds it when one instance has it.

## Item uids

Every item has a `uid` beside its numeric `id`: `item:` and 12 hex of a hash over its kind, who made it and its ordinal there. A route's copper is its route's, by place in the order the router laid it; a pad is its part's, by number; a part's drawing its part's; anything else its call's, the file and the text of the range without its `at` and `side`. Twins get `~2`, `~3` in item order.

- A move, a turn, a flip and a line inserted above leave every uid; an edit of a call's other text changes the uids of what it made.
- `itemRev` of `@pcbjs/core/ref` is what an item is now, 12 hex over its kind, layers, net and geometry, a pour's outline never its fill: same uid with another rev, the item changed.
- The numeric `id` indexes one compile and one facet's rows, the SVG `data-id`; findings, facets, plugins and references cross by uid.

## Resolving in code

```ts
import { boardIndex, parseRef, printRef, resolveRef } from '@pcbjs/core/ref'
import type { Board } from '@pcbjs/core/model'

declare const board: Board
const pad = resolveRef(boardIndex(board), 'CH2/R01/1')
if (pad.kind === 'pad') console.log(pad.pad.at, pad.pad.uid)
console.log(printRef(parseRef('route:vccTrunk/pt:2')))
```

`resolveRef` reads a `RefIndex`, which `boardIndex` builds of a board and `siteIndex` of its joined facets; it throws a `RefError` that says what is missing or lists the matches; a plugin's `ctx.resolve` returns the model object or null, see plugins.md.
