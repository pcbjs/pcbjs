// The schematic picture as JSX: <Schematic> and its children are plain nodes, compiled with the board they are passed to.
import { isNode, jsx } from './jsx-runtime.js'
import { callerSite } from './schematic.js'
import type { Child, Net, PcbNode, PinRef, Src, SymPlaceProps } from './types.js'

/** A position in grid units, `"x y"` or `[x, y]`; a string token with a unit, `"5.08mm"`, is converted to grid units. */
export type SchAt = string | readonly [number | string, number | string]

export interface SchematicProps {
  /** grid pitch in mm, default 2.54 */
  grid?: number | string
  /** a fixed paper with a frame and title block: 'A4' to 'A0', landscape, the next size up when it does not fit, or `{ w, h }` in mm; default none, the page fits the drawing */
  sheet?: 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | { w: number | string; h: number | string }
  /** a net with more pins than this gets labels instead of wires, default 6 */
  labelOver?: number
  /** a net whose pins lie further apart than this, in grid units across x plus y, gets labels; default 40 */
  labelFar?: number
  /** false leaves every connection to hand wires and labels; default true */
  route?: boolean
  title?: string
  children?: Child
}
/** The long form of a part element inside `<Schematic>`: `<Sym part={R1} at="4 6" />` is `<R1 at="4 6" />`. */
export interface SymProps extends SymPlaceProps { part: unknown }
export interface LabelProps { net: Net; at: SchAt; dir?: 'left' | 'right' | 'up' | 'down' }
export interface PowerProps { net: Net; at: SchAt; kind?: 'gnd' | 'vcc' }
export interface SheetProps { name?: string; group: unknown; at?: SchAt; children?: Child }
export interface TextProps { at: SchAt; size?: number; children?: Child }

const node = (type: string, props: Record<string, any>): PcbNode => {
  const { children, ...rest } = props
  return jsx(type, { ...rest, ...(children !== undefined ? { children } : {}) })
}

/** The root of a schematic: `const sch = <Schematic>…</Schematic>`, then `<PCB schematic={sch}>`. */
export function Schematic(props: SchematicProps): PcbNode { return node('sch', props) }
/** Places a part's symbol, as the part element `<R1 at="4 6" />` does inside `<Schematic>`. */
export function Sym(props: SymProps): PcbNode { return node('sch-sym', props) }
/** A net label: pins and wire ends at its point join the net by name. */
export function Label(props: LabelProps): PcbNode { return node('sch-label', props) }
/** A power symbol, a label drawn as ground or a supply bar. */
export function Power(props: PowerProps): PcbNode { return node('sch-power', props) }
/** Boxes the symbols of a group() or circuit() instance; children are placed relative to `at`. */
export function Sheet(props: SheetProps): PcbNode { return node('sch-sheet', props) }
/** A note on the sheet. */
export function Text(props: TextProps): PcbNode { return node('sch-text', props) }

/** The object form of `<Schematic>`. */
export function schematic(props: SchematicProps = {}): PcbNode { return Schematic(props) }

/** A schematic module as a namespace, `import * as sch from './board.sch'`: its parts, nets and maybe its drawing. */
export type SchematicModule = Readonly<Record<string, unknown>>

/** A `<Schematic>` element or `schematic({ … })`, as opposed to a schematic module. */
export function isSchematicDrawing(v: unknown): v is PcbNode {
  return isNode(v) && (v.type === 'sch' || v.type === Schematic)
}

/** The drawing a `<PCB schematic>` value names: itself, else its `drawing` or `default` export, else any export that is one. */
export function schematicDrawing(v: PcbNode | SchematicModule | null | undefined): PcbNode | undefined {
  if (v === null || v === undefined) return undefined
  if (isNode(v)) return v
  for (const k of ['drawing', 'default']) if (isNode(v[k])) return v[k] as PcbNode
  return Object.values(v).find(isSchematicDrawing)
}

/** One step of a hand wire, grid units. */
export type WireStep = { op: 'h' | 'v' | 'H' | 'V'; n: number } | { op: 'l' | 'L'; x: number; y: number } | { op: 'Z'; to: PinRef | SchAt }
export interface WireBuilder extends PcbNode {
  /** relative moves */
  h(n: number): WireBuilder
  v(n: number): WireBuilder
  l(dx: number, dy: number): WireBuilder
  /** absolute moves */
  H(x: number): WireBuilder
  V(y: number): WireBuilder
  L(x: number, y: number): WireBuilder
  /** to a pin or point, with one bend when they do not line up */
  Z(to: PinRef | SchAt): WireBuilder
}

/** A hand wire from a pin or a point, square steps in grid units: `wire(U1.VSSA).h(2).v(-3).Z(C1[1])`. */
export function wire(from: PinRef | SchAt, opts?: { __src?: Src }): WireBuilder {
  const steps: WireStep[] = []
  const src: Src | undefined = opts?.__src ?? callerSite()
  const n = jsx('sch-wire', { from, steps, ...(src ? { __src: src } : {}) }) as WireBuilder
  const num = (v: unknown, what: string) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`wire().${what} takes a number of grid units, got ${JSON.stringify(v)}`); return v }
  const def = (name: string, f: (...a: any[]) => void) => Object.defineProperty(n, name, {
    value: (...a: any[]) => {
      if (steps.at(-1)?.op === 'Z') throw new TypeError(`wire().${name}: nothing may follow .Z()`)
      f(...a)
      return n
    }, enumerable: false,
  })
  for (const op of ['h', 'v', 'H', 'V'] as const) def(op, (v: number) => steps.push({ op, n: num(v, op) }))
  for (const op of ['l', 'L'] as const) def(op, (x: number, y: number) => steps.push({ op, x: num(x, op), y: num(y, op) }))
  def('Z', (to: PinRef | SchAt) => steps.push({ op: 'Z', to }))
  return n
}
