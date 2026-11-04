# Patches

Edits by reference for copper that has no source of its own, the router's legs and vias: add a via, set a route's width, reroute a leg, hold a route as it routed.
Advanced. Each patch names its target, the operation and a hash of the target it was written against; a target that changed skips the patch with a `patch-stale` warning. A part or a drawn trace is changed where it is written, editing.md.

```tsx
import PCB, { patch } from '@pcbjs/core'

export default (
  <PCB name="Patched" rev="0.1.0" patches={[patch('route:2', { width: 0.4 }, 'c4d1e07a92b3')]}>
    {patch('net:GND', { via: { at: '12 8' } }, '5e0f7a3b19c2')}
  </PCB>
)
```

## Operations

| Operation | Targets | Does | Runs |
| --- | --- | --- | --- |
| `{ via: { at, span?, drill?, size?, net? } }` | a net `net:GND`, a route `route:3`, a plane `plane:In1.Cu:GND` | adds a via at `at`, on the target's net unless `net` says another or `null` for none, through every copper layer unless `span` names two; on a plane it is a stitching via | `patches`, after `tune` |
| `{ width: mm }` | a route `route:3` | sets the width of the route's tracks as tuned | `patches` |
| `{ reroute: { through? } }` | a leg `route:3/leg:2` | routes the leg again: through each `'x y'` waypoint as automatic legs of their own, or with none past the route memo | before `autoroute` |
| `{ hold: { tracks, vias } }` | a route `route:3` | places the copper of the route's automatic legs in place of routing them, before every other leg, so it is an obstacle the router never moves | before `autoroute` |

- There is no operation that moves a part or a via: a part moves where its `at` is written, and the router's vias move with a `reroute` or a `hold`.
- Copper operations run in the `patches` stage after `tune` and before `finish`, so pours, teardrops and every check see them.
- A hold keeps each leg as the router placed it, before tuning: tuning runs over it as over any leg. Its tracks and vias carry `leg`, 1-based, when the route has more than one automatic leg.

## The target hash

Every patch carries 12 hex of what its meaning depends on, never the copper or parts around its target, so a neighbour's edit leaves it:

| Operation | Hash over |
| --- | --- |
| `hold`, `reroute` | the route request: ends, net, width, layers and chain |
| `width` | the route's track points and vias |
| `via` | the target: the net, the route and its net, or the plane's layer and net |

A missing target or another hash skips the patch with a `patch-stale` warning naming the target, both hashes and the patch's source, its `src` of role `patch`; a hold says which snapshot it was taken from. Each route record in the board data carries its `hash`; tools write the others.

## Sources and the patches file

Patches merge in this order, a later one on the same target applying after an earlier one:

1. `<PCB patches>`, a list of `patch()` calls.
2. `{patch(ref, op, hash)}` anywhere in the tree, in tree order.
3. The default export of the file beside the entry with `.tsx` replaced by `.patches.ts`: `pcb.patches.ts` for `pcb.tsx`, `blinky.pcb.patches.ts` for `blinky.pcb.tsx`.

```ts file=pcb.patches.ts
import { patch } from '@pcbjs/core'

export default [patch('route:2', { width: 0.4 }, '9a0b1c2d3e4f')]
```

The file is tracked source: commit it with the board. Tools and editors write it; the stage cache keys on it like any file the entry reads.

## Freezing a route

```sh
pcbjs patch hold route:3
pcbjs patch hold route:vccTrunk --entry blinky.pcb.tsx
```

`pcbjs patch hold <route>` compiles the entry and writes a `hold` of the route's automatic legs as they routed into the patches file, replacing an earlier hold of the same route, with the snapshot it was taken from. It is the one way to freeze a result: a held route keeps its copper until its request, ends, net, width or layers change, and a held route crossing new copper is a DRC finding, not a move. `--target` takes the copper from one variant target; `--entry` names the board when the config lists several.
