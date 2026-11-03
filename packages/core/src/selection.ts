// The selection every view, the tree, the editor and the session share for one board: references of refs.md with an anchor.

export type Ref = string
export type SetBy = 'editor' | 'viewer' | 'tree' | 'url' | 'sync' | 'agent'

/** An isolated instance: what is shown, the instance it is shown in, every instance of its circuit, and whether it is a preview of a group no board uses. */
export interface Isolation {
  ref: Ref
  context: Ref
  instances: Ref[]
  preview: boolean
  mode?: 'instance' | 'library'
}

/** What the cursor names that is no entity: board points to mark and a reference to outline. */
export interface Marks {
  points?: [number, number][]
  reference?: string
  /** schematic elements of the code no member stands for, `wire:3` and `label:1` */
  sch?: string[]
}

export interface Selection {
  board: string
  target: string | null
  snapshot: string
  /** in joining order; never an entity together with its ancestor */
  refs: Ref[]
  /** the primary: clicked or added last, drawn thicker, first in the chip */
  anchor: Ref | null
  /** the entered level, null for the board root */
  level: Ref | null
  isolate: Isolation | null
  finding?: string | null
  isolateChoice?: Isolation | null
  marks?: Marks
  by: SetBy
  client: { client: string; name: string; role?: string } | null
  /** stamped by the session; 0 for one it has not seen */
  seq: number
}

export function emptySelection(board: string, target: string | null = null, by: SetBy = 'viewer'): Selection {
  return { board, target, snapshot: '', refs: [], anchor: null, level: null, isolate: null, by, client: null, seq: 0 }
}

/** Removing the anchor promotes the member before it, else the last left. */
export function withoutRef(sel: Selection, ref: Ref): Selection {
  const i = sel.refs.indexOf(ref)
  if (i < 0) return sel
  const refs = sel.refs.filter(r => r !== ref)
  const anchor = sel.anchor === ref ? (refs[i - 1] ?? refs[refs.length - 1] ?? null) : sel.anchor
  return { ...sel, refs, anchor }
}

/** `?select=` as the URL carries it: the anchor first, then the others in joining order; null for none. */
export function selectParam(sel: Pick<Selection, 'refs' | 'anchor'>): string | null {
  if (!sel.refs.length) return null
  const a = sel.anchor && sel.refs.includes(sel.anchor) ? sel.anchor : sel.refs[sel.refs.length - 1]
  return [a, ...sel.refs.filter(r => r !== a)].join(',')
}

/** The members of a `?select=` list, in joining order with the anchor last, and the anchor. */
export function parseSelectParam(text: string | null | undefined): { refs: Ref[]; anchor: Ref | null } {
  const list = [
    ...new Set(
      (text ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    ),
  ]
  if (!list.length) return { refs: [], anchor: null }
  return { refs: [...list.slice(1), list[0]], anchor: list[0] }
}

/** True when two selections show the same thing; seq, by and client aside. */
export function sameSelection(a: Selection, b: Selection): boolean {
  return (
    a.board === b.board &&
    a.target === b.target &&
    a.snapshot === b.snapshot &&
    a.anchor === b.anchor &&
    a.level === b.level &&
    (a.finding ?? null) === (b.finding ?? null) &&
    a.refs.length === b.refs.length &&
    a.refs.every((r, i) => r === b.refs[i]) &&
    JSON.stringify(a.isolate) === JSON.stringify(b.isolate) &&
    JSON.stringify(a.isolateChoice ?? null) === JSON.stringify(b.isolateChoice ?? null) &&
    JSON.stringify(a.marks ?? null) === JSON.stringify(b.marks ?? null)
  )
}

/** Normalize members and findings; clearing entity focus leaves the current instance editing context. */
export function normalizeSelection(s: Selection, findings?: readonly { id?: string; refs?: readonly string[] }[], previous?: Selection): Selection {
  const refs = [...new Set(s.refs)]
  const anchor = s.anchor && refs.includes(s.anchor) ? s.anchor : refs[refs.length - 1] ?? null
  let finding = s.finding ?? null
  if (finding && anchor && anchor !== finding && findings) {
    const affected = findings.find(f => f.id === finding)?.refs ?? []
    if (!affected.some(ref => ref === anchor || ref.startsWith(anchor + '/') || anchor!.startsWith(ref + '/'))) finding = null
  }
  const blurred = !refs.length && !previous?.finding && previous?.refs.length && previous.isolate?.mode === 'instance' && s.isolate?.mode === 'instance' && s.isolate.ref === previous.isolate.ref
  return { ...s, refs, anchor, finding, ...(blurred ? { isolate: null, isolateChoice: null, level: null } : {}) }
}

/** Validate a complete selection before accepting it from a transport. */
export function isSelection(value: unknown): value is Selection {
  if (!value || typeof value !== 'object') return false
  const s = value as Selection
  const nullable = (v: unknown) => v === null || typeof v === 'string'
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(r => typeof r === 'string')
  const isolation = (v: unknown) => {
    if (v === null) return true
    if (!v || typeof v !== 'object') return false
    const i = v as Isolation
    return typeof i.ref === 'string' && typeof i.context === 'string' && strings(i.instances) && typeof i.preview === 'boolean' && (i.mode === undefined || i.mode === 'instance' || i.mode === 'library')
  }
  if (typeof s.board !== 'string' || !nullable(s.target) || typeof s.snapshot !== 'string' || !strings(s.refs) || !nullable(s.anchor) || !nullable(s.level) || !isolation(s.isolate) || (s.isolateChoice !== undefined && !isolation(s.isolateChoice)) || (s.finding !== undefined && !nullable(s.finding))) return false
  if (s.marks !== undefined) {
    const m = s.marks
    if (!m || typeof m !== 'object' || (m.reference !== undefined && typeof m.reference !== 'string') || (m.sch !== undefined && !strings(m.sch)) || (m.points !== undefined && (!Array.isArray(m.points) || !m.points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n)))))) return false
  }
  return Number.isSafeInteger(s.seq) && s.seq >= 0 && ['editor', 'viewer', 'tree', 'url', 'sync', 'agent'].includes(s.by)
}
