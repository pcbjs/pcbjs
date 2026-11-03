// The schematic picture as JSX: <Schematic> and its children are plain nodes, compiled with the board they are passed to.
import { isNode, jsx } from './jsx-runtime.js'
import { callerSite } from './provenance.js'
import type { Child, Net, PcbNode, PinRef, Src } from './types.js'

/** A position in grid units, `"x y"`. */
export type SchAt = string

export interface SchematicProps {
  /** the grid, a pitch in mm or a `defineGrid` grid; default 100 mil */
  grid?: number | import('./grid.js').Grid
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
export interface LabelProps {
  net: Net
  at: SchAt
  dir?: 'left' | 'right' | 'up' | 'down'
}
export interface PowerProps {
  net: Net
  at: SchAt
  kind?: 'gnd' | 'vcc'
}
export interface SheetProps {
  name?: string
  group: unknown
  at?: SchAt
  /** positions inside are in this grid's units, its pitch a whole multiple of the schematic's */
  grid?: import('./grid.js').Grid
  children?: Child
}
export interface TextProps {
  at: SchAt
  size?: number
  children?: Child
}

const node = (type: string, props: Record<string, any>): PcbNode => {
  const { children, ...rest } = props
  return jsx(type, { ...rest, ...(children !== undefined ? { children } : {}) })
}

/** The root of a schematic drawing, the `drawing` export of a schematic module: `export const drawing = <Schematic>…</Schematic>`. */
export function Schematic(props: SchematicProps): PcbNode {
  return node('sch', props)
}
/** A net label: pins and wire ends at its point join the net by name. */
export function Label(props: LabelProps): PcbNode {
  return node('sch-label', props)
}
/** A power symbol, a label drawn as ground or a supply bar. */
export function Power(props: PowerProps): PcbNode {
  return node('sch-power', props)
}
/** Boxes the symbols of a circuit instance; children are placed relative to `at`. */
export function Sheet(props: SheetProps): PcbNode {
  return node('sch-sheet', props)
}
/** A note on the sheet. */
export function Text(props: TextProps): PcbNode {
  return node('sch-text', props)
}

/** A schematic module as a namespace, `import * as sch from './board.sch'`: its parts, nets and maybe its drawing. */
export type SchematicModule = Readonly<Record<string, unknown>>

/** A `<Schematic>` element. */
export function isSchematicDrawing(v: unknown): v is PcbNode {
  return isNode(v) && (v.type === 'sch' || v.type === Schematic)
}

/** The drawing of a schematic module: its `drawing` export. */
export function schematicDrawing(v: SchematicModule | null | undefined): PcbNode | undefined {
  const d = v?.drawing
  return isNode(d) ? d : undefined
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
  const num = (v: unknown, what: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`wire().${what} takes a number of grid units, got ${JSON.stringify(v)}`)
    return v
  }
  const def = (name: string, f: (...a: any[]) => void) =>
    Object.defineProperty(n, name, {
      value: (...a: any[]) => {
        if (steps.at(-1)?.op === 'Z') throw new TypeError(`wire().${name}: nothing may follow .Z()`)
        f(...a)
        return n
      },
      enumerable: false,
    })
  for (const op of ['h', 'v', 'H', 'V'] as const) def(op, (v: number) => steps.push({ op, n: num(v, op) }))
  for (const op of ['l', 'L'] as const) def(op, (x: number, y: number) => steps.push({ op, x: num(x, op), y: num(y, op) }))
  def('Z', (to: PinRef | SchAt) => steps.push({ op: 'Z', to }))
  return n
}
