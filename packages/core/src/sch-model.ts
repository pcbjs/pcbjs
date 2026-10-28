// The compiled schematic picture, `board.schematic.drawing`: millimetres in the sheet's frame, y down, the grid at whole multiples of `grid`.
import type { Mat, Pt } from './model.js'
import type { Src } from './types.js'
import type { PinSide, SymbolShape } from './sch-symbol.js'

export type { PinSide, SymbolShape }

export interface SchPin {
  name: string
  net: string | null
  nc: boolean
  /** where a wire connects, and where the pin meets the body */
  end: Pt
  root: Pt
  /** the way the pin points out of the body, on the sheet */
  side: PinSide
  /** the PCB pad ids of the pin */
  items: number[]
}
export interface SchSymbol {
  ref: string
  value: string
  /** 'resistor', 'box', 'connector', 'custom' and so on */
  kind: string
  /** the symbol origin in mm, its rotation in degrees counterclockwise and the mirror */
  at: Pt
  rot: number
  flip: boolean
  /** the symbol frame, grid units, to the sheet, mm */
  m: Mat
  /** the body in the symbol frame, grid units */
  body: SymbolShape[]
  /** the body's bounds on the sheet, x0 y0 x1 y1 mm */
  box: [number, number, number, number]
  pins: SchPin[]
  /** pin names drawn inside the body */
  names: boolean
  /** where the ref and the value are written, mm, text anchored at its start */
  refAt: Pt
  valueAt: Pt
  /** placed by the compiler, not by a part element or <Sym> */
  auto: boolean
  /** the circuit instance path of the part, [] at the board level */
  path: string[]
  /** the PCB pad ids of the part */
  items: number[]
  src?: Src
}
export interface SchWire {
  /** `wire:<n>` */
  id: string
  net: string
  /** an orthogonal polyline in mm */
  pts: Pt[]
  auto: boolean
  src?: Src
}
export interface SchLabel {
  /** `label:<n>` */
  id: string
  net: string
  at: Pt
  /** the way the label points away from what it is attached to */
  side: PinSide
  kind: 'label' | 'gnd' | 'vcc'
  auto: boolean
  src?: Src
}
export interface SchJunction {
  net: string
  at: Pt
}
export interface SchSheetBox {
  name: string
  path: string[]
  box: [number, number, number, number]
  auto: boolean
  src?: Src
}
export interface SchText {
  text: string
  at: Pt
  size: number
  src?: Src
}
/** What the drawing holds; `length` in mm, `crossings` wire over wire of another net, `rounds` of negotiation. */
export interface SchStats {
  symbols: number
  wires: number
  segments: number
  bends: number
  crossings: number
  labels: number
  power: number
  junctions: number
  length: number
  /** nets drawn with wires, nets drawn with labels */
  wired: number
  labelled: number
  rounds: number
}
export interface SchDrawing {
  /** the grid pitch, mm */
  grid: number
  /** the page, x0 y0 x1 y1 mm: the paper, else everything drawn grown by a margin */
  page: [number, number, number, number]
  /** the fixed paper with its frame and title block, only when `<Schematic sheet>` asks for one, mm */
  paper?: { name: string; w: number; h: number }
  title: string
  symbols: SchSymbol[]
  wires: SchWire[]
  labels: SchLabel[]
  junctions: SchJunction[]
  /** no-connect marks at pins connected to NC */
  noConnects: Pt[]
  sheets: SchSheetBox[]
  texts: SchText[]
  stats: SchStats
}
