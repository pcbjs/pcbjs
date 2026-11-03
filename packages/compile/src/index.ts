import type { Child } from '@pcbjs/core/internal/types'
import type { Board } from '@pcbjs/core/model'
import { rootBoard, variantsOf, CompileError, type CompileOptions } from './flatten.js'
import { compileStages } from './pipeline.js'

export { CompileError }
export { routers } from './autoroute.js'
export type { CompileOptions }
export type { RouteProgress } from './autoroute.js'
export { compileLoaded, compileStages, demanded, sketch, strictestRules, cutoutFindings, CancelledError, STAGES } from './pipeline.js'
export type { CheckDef, CompileResult, Exporter, Load, StageDef, StageTime } from './pipeline.js'
export type { DepGraph, Facet, Hook, PcbPlugin, Slot, StageContext, StageDelta, StageInput, StageName, View } from '@pcbjs/core/internal/plugin'

/** Node tree -> compiled board: items, zone fills, connectivity, DRC. For a board made with variants(), use compileBoards. */
export function compileBoard(root: Child, opts: CompileOptions = {}): Board {
  const node = rootBoard(root)
  if (variantsOf(node)) throw new CompileError(`<PCB ${node.props.name}> has fab variants: use compileBoards(root), which returns one board per target`)
  return compileStages(root, opts)[0].board
}

/** Node tree -> one compiled board per fab target, in the order of the variants list; a single board when there are none. */
export function compileBoards(root: Child, opts: CompileOptions = {}): Board[] {
  return compileStages(root, opts).map(r => r.board)
}
