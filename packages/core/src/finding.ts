// The shape of a DRC or ERC finding as `check --json` reports it, see docs/findings.md.
import type { Pt, Ring } from './model.js'

export interface Quantity {
  value: number
  unit: 'mm' | 'mm2' | 'deg' | 'ohm' | 'ps' | 'A' | 'count'
}
/** A range of a project file, 1-based, end inclusive; `role` says what the range is to the finding. */
export interface SourceRef {
  file: string
  start: [number, number]
  end: [number, number]
  role: 'item' | 'call' | 'rule' | 'part' | 'patch'
}
/** One level that set a rule's value, the winner first; `name` is the class, part or pad, `to` the kind a scoped clearance holds toward. */
export interface RuleProvenance {
  rule: string
  value: Quantity
  from: 'preset' | 'defaults' | 'board' | 'class' | 'rules' | 'part' | 'pad' | 'plugin'
  name?: string
  to?: string
  src?: SourceRef
}
/** The geometry that shows a finding: the closest point pair, a segment, a polyline or overlap rings. */
export interface Witness {
  layer?: string
  points?: Pt[]
  segments?: [Pt, Pt][]
  rings?: Ring[]
}
export type TemplateArg = string | number | boolean | null | string[] | number[]
/** What a rule's message template reads beyond refs, measured, required and provenance. */
export type TemplateArgs = Record<string, TemplateArg>

export interface Finding {
  /** exact within one snapshot: `drc:<rule>:<12 hex>` */
  id: string
  /** 16 hex over board, target, layer, rule and the sorted refs: the same finding across snapshots, not unique */
  fingerprint: string
  kind: 'drc' | 'erc'
  severity: 'error' | 'warning' | 'info'
  rule: string
  board: string
  target?: string
  layer?: string
  /** board mm, null for a finding with no position */
  at: Pt | null
  refs: string[]
  /** the uids of the items the checker named */
  items: string[]
  measured?: Quantity
  required?: Quantity
  witness?: Witness
  provenance?: RuleProvenance[]
  args?: TemplateArgs
  src: SourceRef[]
  message: string
  /** the `route:<n>` or `route:<name>` it concerns, as inspect --lengths names it */
  route?: string
  /** where a view draws it, computed once from what the checker knows */
  mark: Mark
}

/** Where a finding is drawn: a dot at a point on a layer and its side; a line, the ratsnest line's index when it lies on one, a failed leg's own ends when none does; or nowhere, a schematic finding or one of no placed part. */
export type Mark = { at: Pt; layer: string; side: 'F' | 'B' } | { line: [Pt, Pt]; rats: number | null; layer: string } | null
