# Plugins

A plugin adds stages, hooks and checks to the compile: its stages run in two slots, its hooks before and after any built-in stage, its checks beside DRC.
Advanced. Register plugins in `defineConfig({ plugins })` and on `<PCB plugins>`; design.md has the stage graph they plug into.

## Registering

```ts
import { defineConfig } from '@pcbjs/core'
import { frame } from './frame.plugin'

export default defineConfig({ entries: ['pcb.tsx'], plugins: [frame(80)] })
```

- The config's plugins come first, then those of `<PCB plugins={[…]}>`, in the order given. Stages of one slot run in that order, and so do the hooks of one stage.
- A plugin name registered twice is a compile error, as is a hook on `before.evaluate`, `after.evaluate` or `before.place`, which have no board yet, an unknown slot, stage or facet, and a check rule that does not start with `<plugin>.`.

## The plugin

```ts
import type { Facet, FindingInput, StageContext, StageDelta, StageInput, StageName } from '@pcbjs/core'

interface PcbPlugin {
  name: string
  version: string
  stages?: { name: string; slot: 'beforeRoute' | 'beforeChecks'; reads: Facet[]; run(board: StageInput, ctx: StageContext): StageDelta }[]
  before?: Partial<Record<StageName, Hook>>
  after?: Partial<Record<StageName, Hook>>
  checks?: { rule: `${string}.${string}`; reads: Facet[]; run(board: StageInput, ctx: StageContext): FindingInput[] }[]
  /** Stable identity of configuration captured by stages, hooks and checks. */
  cacheKey?: string
  /** Explicit opt-in for plugins pure in version and declared reads; false always disables caching. */
  cache?: boolean
}
type Hook = (board: StageInput, ctx: StageContext) => StageDelta | void
```

- `beforeRoute` runs after manual copper and before the router: copper a stage adds there is an obstacle to every leg. `beforeChecks` runs after `finish`, so it sees tuned copper, filled zones and silk refs, and the checks see what it adds.
- A hook's delta applies to its stage's input for `before` and to its output for `after`. The stage names are `evaluate`, `place`, `schematic`, `manualCopper`, `autoroute`, `placeFollowers`, `routeFollowers`, `tune`, `patches`, `finish`, `checks` and `exports`.
- `reads` lists the facets a stage or check reads: `meta`, `rules`, `stackup`, `outline`, `keepouts`, `parts`, `pads`, `copper`, `drawings`, `frame`, the item ids and kinds, `nets`, `netlist`, `routes`, `findings`, `edit`, `plugins`, `stats`, `sch`, `rest`, the board fields none names, `jobs`, `jobs.finish`, `jobs.sch` and `models`. They key it: a `beforeChecks` stage and a check are each cached on the hashes of their reads and the plugin's name, version and configuration key, and a `beforeRoute` stage's reads join the routing's key. A read left out serves stale output. Use `cacheKey`, such as `JSON.stringify(options)`, for configuration and bump `version` for implementation changes. Without a key or explicit `cache: true`, plugins are uncached; `cache: false` always disables caching. Any plugin prevents evaluation-free whole-board startup reuse, including keyed plugins declared in config or on `<PCB>`. Re-evaluation discovers current plugin options and cache policy; keyed stages can still hit their cache. The startup fingerprint also includes a digest of the environment, so enabling a previously absent plugin through an environment variable invalidates that bypass. Environment values are not written into the cache index.
- A hook runs inside the cached unit of the stage it hooks, which then keys on every facet and the plugin's name, version and configuration key.
- Stages, hooks and checks are synchronous; a promise returned is a compile error.
- A check's findings run after the built-in DRC and take its rule; `kind: 'erc'` puts a finding in ERC, DRC otherwise. Each keeps the message it gives, may name `refs`, `measured`, `required` and `witness`, and gets an id and a fingerprint as findings.md says.

## Reading the board

`StageInput` is the compiled `Board` as the stages before left it, read-only, with `deps`, the placement dependency graph: `nodes` of kind `part`, `route` and `reference`, and `edges` `[from, to, why]` from each route to the parts it ends on. A stage never writes its input; under `PCBJS_FREEZE=1`, set in the tests, the board it gets is frozen and a write throws.

```ts
import type { DrcMarker, Footprint, Item, Net, PairInfo, RouteRecord } from '@pcbjs/core/model'

interface StageContext {
  board: string
  target?: string
  /** `<plugin>/<stage>`, `<plugin>/before:<stage>` for a hook */
  stage: string
  /** any reference of refs.md as its model object: a part, a pad `R1/2`, `net:VCC`, `route:3`, `pair:1`, `item:<uid>`, a finding by id */
  resolve(ref: string): Footprint | Item | Net | RouteRecord | PairInfo | DrcMarker | null
  memo<T>(scope: string, key: string, make: () => T): T
  log(line: string): void
}
```

`ctx.log` lines print under the stage in `pcbjs check --verbose`; `memo` keeps one value per scope and key for the whole compile.

## The delta

```ts
import type { FindingInput, Json, NewItem } from '@pcbjs/core'
import type { RouteRecord } from '@pcbjs/core/model'

interface StageDelta {
  add?: NewItem[]
  remove?: string[]
  replace?: { uid: string; item: NewItem }[]
  routes?: RouteRecord[]
  findings?: FindingInput[]
  data?: Record<string, Json>
}
```

- `add` takes items without an id or uid and gives each the next free id and its uid, refs.md; `remove` and `replace` name items by uid, a replaced item keeping its id and getting the uid of what replaces it. Removes and replaces apply before adds.
- `routes` adds route records; `findings` adds findings, held until `checks` when they come before it, so they follow the built-in ones; `data` merges into `board.plugins[name]`, which the board JSON carries.

## An example

A plugin that draws a silk frame 1 mm inside the board, records each route's tuned length and warns when the board is wider than `max` mm:

```ts file=frame.plugin.ts
import { definePlugin } from '@pcbjs/core'

export const frame = (max = 100) =>
  definePlugin({
    name: 'frame',
    version: '1',
    cacheKey: JSON.stringify({ max }),
    stages: [
      {
        name: 'draw',
        slot: 'beforeChecks',
        reads: ['outline'],
        run: board => {
          const { x, y, w, h } = board.bbox
          const ring: [number, number][] = [
            [x + 1, y + 1],
            [x + w - 1, y + 1],
            [x + w - 1, y + h - 1],
            [x + 1, y + h - 1],
            [x + 1, y + 1],
          ]
          return { add: [{ kind: 'graphic', layer: 'F.SilkS', width: 0.15, paths: [ring], closed: [true], fill: false }] }
        },
      },
    ],
    after: {
      tune: board => ({ data: { tuned: Object.fromEntries((board.routes ?? []).map(r => [r.id, r.tuned ?? 0])) } }),
    },
    checks: [
      {
        rule: 'frame.width',
        reads: ['outline'],
        run: board =>
          board.bbox.w > max ? [{ severity: 'warning', rule: 'frame.width', message: `the board is ${board.bbox.w} mm wide, over ${max} mm`, at: [board.bbox.x, board.bbox.y] }] : [],
      },
    ],
  })
```

`pcbjs check --verbose` then prints `stage  frame/draw`, `stage  frame/after:tune` and `stage  frame/frame.width` among the stages, and a board over the width gets the warning `frame.width`.

## Compiling from code

`compileStages(root, opts)` of `@pcbjs/compile` returns one `{ board, exports, stages }` per fab target; `compileBoards` returns the boards. Its options beside references and progress:

- `compileLoaded(load, opts)` takes the evaluation from the caller: `load` resolves with `{ root, options }`, the options the loading decides such as `cache.files`, and is the `evaluate` stage, timed, cancelled and reported with the others.
- `cache`, false for none, else `{ dir, draft, entry, files, env }`: route memos in `dir`, `.pcbjs/cache` of a project by default, and with `entry` and the sha1 of each evaluated file in `files` the stage outputs too, see design.md.

- `plugins`, before those of `<PCB plugins>`.
- `want`, the views the caller needs, `meta`, `sch`, `layers`, `shapes`, `model`, `findings` and `fab`: only the stages they need run, so `['sch']` runs `evaluate`, `place` and `schematic`. Absent runs every stage.
- `exports`, the formats of the `exports` stage, each `{ name, key?, inputs?, run(board, done) }` given what the formats before it returned; `key` says what it reads beyond the board and `inputs` what it reads from files, and without one on every format the stage is never cached.
- `signal`, an `AbortSignal` or any `{ aborted }`: the compile checks it between stages and between the legs, zones, routes, checks and formats inside one, and throws `CancelledError`, the stages it finished kept in the cache.
