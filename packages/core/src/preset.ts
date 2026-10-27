// bindPCB, which makes the bound component, is in @pcbjs/fab.
import type { AutoRouteParams, BoardProps, CplOptions, Finish, NetClass, PcbNode, Rules, Stackup } from './types.js'

/** What a fab preset is made of. `colors` and `silkColors` map a colour name to a hex value for the 3D view. */
export interface PresetInput {
  stackup: Stackup
  rules: Rules
  colors?: Record<string, string>
  silkColors?: Record<string, string>
  finishes?: readonly Finish[]
  /** such as "JLCPCB 2-Layer" */
  name?: string
  /** such as "JLCPCB" */
  fab?: string
  /** sourcing tags in order, such as `['LCSC', 'CN']` */
  sourcing?: readonly string[]
  /** merged under the element's `autoroute` */
  autoroute?: Partial<AutoRouteParams>
  /** merged class by class under the element's `classes` */
  classes?: Record<string, NetClass>
  /** under the element's `cpl` */
  cpl?: CplOptions
  /** before the element's `fabNotes` */
  fabNotes?: readonly string[]
}

/** The frozen spec a bound component carries as `preset`. */
export interface PresetSpec {
  name: string
  fab: string
  stackup: Readonly<Stackup>
  rules: Readonly<Rules>
  colors: Readonly<Record<string, string>>
  silkColors: Readonly<Record<string, string>>
  finishes: readonly Finish[]
  sourcing?: readonly string[]
  autoroute?: Readonly<Partial<AutoRouteParams>>
  classes?: Readonly<Record<string, NetClass>>
  cpl?: Readonly<CplOptions>
  fabNotes?: readonly string[]
}

/** The props of a preset board: every <PCB> prop, plus the mask colour, the legend colour and the finish. */
export interface PresetBoardProps extends BoardProps {
  /** mask colour: a name from the fab's palette, any case, or any CSS colour */
  color?: string
  /** legend colour: a name from the fab's palette, any case, or any CSS colour */
  silk?: string
  finish?: Finish
}

export interface BoundPCB {
  (props: PresetBoardProps): PcbNode
  readonly preset: PresetSpec
}

const key = (c: string) => c.toLowerCase().replace(/[\s_-]+/g, '')

/** The palette's own spelling of `c`, such as "Matte Black" for "matte-black", or `c` itself when the palette lacks it. */
export function paletteName(palette: Record<string, string>, c: string): string {
  const k = key(c)
  return Object.keys(palette).find(n => key(n) === k) ?? c
}

/** True for a component made by bindPCB, which carries its preset spec. */
export function isBoundPCB(fn: unknown): fn is BoundPCB {
  return typeof fn === 'function' && !!(fn as any).preset && typeof (fn as any).preset === 'object' && 'stackup' in (fn as any).preset && 'rules' in (fn as any).preset
}
