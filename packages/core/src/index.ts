import { h } from './jsx-runtime.js'
import type { BoardProps, Child, PartBase, PartProps, PcbNode } from './types.js'
import { isPart } from './part.js'

export type * from './types.js'
export { h, Fragment, isNode, childList } from './jsx-runtime.js'
export { mm, deg, at, size2 } from './units.js'
export type { UserConfig, LibConfig } from './config.js'
export { defineConfig } from './config.js'
export { definePlugin } from './plugin.js'
export type {
  PcbPlugin,
  PluginStage,
  PluginCheck,
  Hook,
  StageDelta,
  StageContext,
  StageInput,
  StageName,
  Slot,
  Facet,
  View,
  FindingInput,
  NewItem,
  DepGraph,
  DepNode,
  Json,
} from './plugin.js'
export type { FontSpec } from './types.js'
export { defineDefaultBoard, resetDefaults, BASE_BOARD } from './defaults.js'
export type { BoardSpec, ResolvedBoardSpec } from './defaults.js'
export type { BoundPCB, PresetSpec, PresetBoardProps } from './preset.js'
export { variants, isVariants, variantSlug } from './variants.js'
export { nets, local, bus, NC, isNet, isNC, isPinRef, SchematicError } from './nets.js'
export { part, isPart, bindRef } from './part.js'
export { defineFootprint } from './footprint.js'
export { resolveSourcing } from './sourcing.js'
export { reference } from './reference.js'
export { patch } from './patch.js'
export { defineGrid, isGrid } from './grid.js'
export type { Grid, GridSpec, GridResolver, FootprintPoint, PlacementGrid } from './grid.js'
export type { Patch, PatchOp, Hold, HoldTrack, HoldVia } from './patch.js'
export type { ReferenceOptions, ReferenceMate, ReferenceShow, ReferenceStack } from './reference.js'
export { circuit, layout, isCircuit, isCircuitInstance } from './circuit.js'
export { Schematic, Label, Power, Sheet, Text, wire, isSchematicDrawing, schematicDrawing } from './sch-elements.js'
export type { SchematicProps, LabelProps, PowerProps, SheetProps, TextProps, SchAt, WireBuilder, SchematicModule } from './sch-elements.js'
export { defineSymbol, SYMBOLS } from './sch-symbol.js'
export type { SymbolDef, SymbolSpec, SymbolPinSpec, PinSide } from './sch-symbol.js'
export type { Circuit, CircuitInstance, CircuitInstanceBase, CircuitMembers, CircuitOwn, InstanceIndex, Layout, LayoutProps, NetsProxy, Ports, InstanceOf } from './circuit.js'
export type { Sourcing } from './site-data.js'
export type { PartInit, PartArgs } from './part.js'
export type { BoundVariants, VariantTarget, VariantObject, VariantSpec } from './variants.js'

/** Places a part the file cannot name, such as one of an array, on the board or inside `<Schematic>`: `<Place part={LEDS[2]} at="10 5" />`. */
export function Place(props: { part: PartBase<any, any> } & PartProps): PcbNode {
  const { part, children, ...rest } = props as { part: unknown; children?: Child } & Record<string, unknown>
  if (!isPart(part)) throw new TypeError(`<Place> needs part={…}, a part such as LEDS[2], got ${part === undefined ? 'none' : typeof part}`)
  return h(part as any, rest, ...(children === undefined ? [] : [children]))
}

/** The board root. `<PCB name="Blinky">…</PCB>` */
export default function PCB(props: BoardProps): PcbNode {
  const { children, ...rest } = props
  return h('board', rest, children)
}
export { PCB }

export type { PourOptions, ViaOptions, StitchOptions, KeepoutOptions } from './types.js'

export { route, pour, via, stitch, keepout, isViaNode } from './route.js'
export type { ChainCommand } from './route.js'

export type { Child }
