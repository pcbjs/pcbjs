// The default layer lives in the realm so every module copy shares it: the CLI's, pcb.config.ts's and Vite's SSR loader's.
import { BASE, cloneData, deepFreeze } from './rules.js'
import { twoLayer } from './stackups.js'
import { TEARDROP_DEFAULTS } from './teardrop.js'
import { realm } from './realm.js'
import { BASE_AUTOROUTE, resolveBoardSpec, type BoardSpec, type ResolvedBoardSpec } from './board-spec.js'

export type { BoardSpec, ResolvedBoardSpec }

/** The built-in board: 2 layers, 1.6 mm, the BASE rules of `@pcbjs/lib/rules` and the autoroute defaults. Frozen. */
export const BASE_BOARD: Readonly<ResolvedBoardSpec> = deepFreeze({
  rev: '',
  copper: 2,
  thickness: 1.6,
  stackup: twoLayer(),
  rules: BASE,
  sourcing: [],
  autoroute: { ...BASE_AUTOROUTE },
  classes: {},
  fabNotes: [],
  teardrops: { on: false, spec: { ...TEARDROP_DEFAULTS } },
})

/** The global default layer as one spec. */
export function defaultLayer(): BoardSpec {
  const b = realm().defaults
  const out: BoardSpec = { ...(b ?? {}) }
  if (b?.via) out.via = { ...b.via }
  if (b?.rules) out.rules = { ...b.rules }
  if (b?.autoroute) out.autoroute = { ...b.autoroute }
  if (b?.classes) out.classes = cloneData(b.classes) as BoardSpec['classes']
  return out
}

/** The board spec of base, then global defaults, then props; throws on an invalid stackup. */
export function resolveBoard(props: BoardSpec): ResolvedBoardSpec {
  return resolveBoardSpec([defaultLayer(), props])
}

// <PCB> props a default board cannot carry, with the reason
const OWN: Record<string, string> = {
  name: 'name and children belong to each <PCB>',
  children: 'name and children belong to each <PCB>',
  fonts: 'fonts are declared on <PCB fonts>, files relative to the board file',
}

/** Set the default board, BASE_BOARD with `spec` on top, rules included, replacing the earlier one; returns it resolved and frozen. */
export function defineDefaultBoard(spec: BoardSpec): Readonly<ResolvedBoardSpec> {
  if (!spec || typeof spec !== 'object') throw new TypeError('defineDefaultBoard needs an object')
  for (const k of Object.keys(spec)) if (k in OWN) throw new TypeError(`defineDefaultBoard: ${OWN[k]}`)
  const prev = realm().defaults
  realm().defaults = deepFreeze(cloneData({ ...spec }))
  try {
    return deepFreeze(resolveBoardSpec([defaultLayer()]))
  } catch (e) {
    realm().defaults = prev
    throw e
  }
}

/** Clear the default board, back to BASE_BOARD. For tests. */
export function resetDefaults(): void {
  realm().defaults = null
}
