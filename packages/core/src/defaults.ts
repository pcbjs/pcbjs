// The registry lives on globalThis so every module copy shares it: the CLI's, pcb.config.ts's and Vite's SSR loader's.
import type { ResolvedRules, Rules } from './types.js'
import { BASE, cloneData, deepFreeze, mergeRules } from './rules.js'
import { twoLayer } from './stackups.js'
import { TEARDROP_DEFAULTS } from './teardrop.js'
import { BASE_AUTOROUTE, resolveBoardSpec, type BoardSpec, type ResolvedBoardSpec } from './board-spec.js'

export type { BoardSpec, ResolvedBoardSpec }

/** The built-in rule set, `BASE` from `@pcbjs/lib/rules`. Frozen. */
export const BASE_RULES: Readonly<ResolvedRules> = BASE
/** The built-in board: 2 layers, 1.6 mm, BASE_RULES and the autoroute defaults. Frozen. */
export const BASE_BOARD: Readonly<ResolvedBoardSpec> = deepFreeze({
  revision: '',
  copper: 2,
  thickness: 1.6,
  stackup: twoLayer(),
  rules: BASE_RULES,
  sourcing: [],
  autoroute: { ...BASE_AUTOROUTE },
  classes: {},
  fabNotes: [],
  teardrops: { on: false, spec: { ...TEARDROP_DEFAULTS } },
})

interface Registry {
  board: BoardSpec | null
  rules: Partial<Rules> | null
}
const KEY = Symbol.for('pcbjs.defaults')
function registry(): Registry {
  const g = globalThis as any
  return (g[KEY] ??= { board: null, rules: null })
}

const clone = <T>(v: T): T => cloneData(v)

/** The global default layer as one spec: the board default with the rules default merged into its rules. */
export function defaultLayer(): BoardSpec {
  const r = registry()
  const out: BoardSpec = { ...(r.board ?? {}) }
  if (r.board?.rules || r.rules) out.rules = { ...(r.board?.rules ?? {}), ...(r.rules ?? {}) }
  if (r.board?.autoroute) out.autoroute = { ...r.board.autoroute }
  if (r.board?.classes) out.classes = cloneData(r.board.classes) as BoardSpec['classes']
  return out
}

function resolved(): Readonly<ResolvedBoardSpec> {
  return deepFreeze(resolveBoardSpec([defaultLayer()]))
}

/** The board spec of base, then global defaults, then props; throws on an invalid or disagreeing stackup. */
export function resolveBoard(props: BoardSpec): ResolvedBoardSpec {
  return resolveBoardSpec([defaultLayer(), props])
}

/** Set the default board, BASE_BOARD with `spec` on top, replacing the earlier one; returns it resolved and frozen. */
export function defineDefaultBoard(spec: BoardSpec): Readonly<ResolvedBoardSpec> {
  if (!spec || typeof spec !== 'object') throw new TypeError('defineDefaultBoard needs an object')
  if ('name' in spec || 'children' in spec) throw new TypeError('defineDefaultBoard: name and children belong to each <PCB>')
  const prev = registry().board
  registry().board = deepFreeze(clone({ ...spec }))
  try {
    return resolved()
  } catch (e) {
    registry().board = prev
    throw e
  }
}

/** Set the default rules, BASE_RULES with `rules` on top, replacing the earlier ones; returns them frozen. */
export function defineDefaultRules(rules: Partial<Rules>): Readonly<Rules> {
  if (!rules || typeof rules !== 'object') throw new TypeError('defineDefaultRules needs an object')
  const prev = registry().rules
  registry().rules = deepFreeze(clone({ ...rules }))
  try {
    return resolved().rules
  } catch (e) {
    registry().rules = prev
    throw e
  }
}

/** Clear both default layers, back to BASE_BOARD and BASE_RULES. For tests. */
export function resetDefaults(): void {
  const r = registry()
  r.board = null
  r.rules = null
}

export { mergeRules }

/** The default layers at one moment, for a dev server that keeps several projects in one process. */
export interface DefaultsSnapshot {
  board: BoardSpec | null
  rules: Partial<Rules> | null
}

/** The default board and rules as they are now. Both are frozen, so the snapshot shares them. */
export function captureDefaults(): DefaultsSnapshot {
  const r = registry()
  return { board: r.board, rules: r.rules }
}

/** Put a snapshot back as the default layers, replacing what is there. */
export function installDefaults(s: DefaultsSnapshot): void {
  const r = registry()
  r.board = s.board
  r.rules = s.rules
}
