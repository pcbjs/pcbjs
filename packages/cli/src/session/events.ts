// The session's events log: ids and cursors `<session>:<seq>` gapless from 1, the last 10 000 kept, and the subscriptions that follow it. docs/queries.md has the kinds.
import { diffEdit, textDoc } from '@pcbjs/core/internal/textdoc'
import { EVENT_KINDS, cursorOf, parseCursor, type By, type EditRange, type EventData, type EventKind, type SessionEvent } from '@pcbjs/core/protocol'

export const KEEP = 10_000

/** Which events a subscriber gets: its kinds, its project, and a test of the scope. */
export interface Filter {
  kinds?: ReadonlySet<EventKind> | null
  project?: string
  /** false drops the event; absent keeps every one */
  scope?: (e: SessionEvent) => boolean
  /** the kinds that make the subscriber an observer, its kinds when absent */
  demand?: readonly EventKind[]
}

export interface EventLog {
  push<K extends EventKind>(kind: K, project: string, data: EventData[K], by?: By | null): SessionEvent<K>
  /** the events after a cursor, an id of this session; one below the floor or of another session starts with a reset */
  since(cursor: string | null, f?: Filter): { events: SessionEvent[]; reset?: string; next: string }
  /** every event pushed from now that passes the filter; returns the unsubscribe */
  subscribe(f: Filter, fn: (e: SessionEvent) => void): () => void
  /** the current cursor */
  next(): string
  /** the kinds every subscriber follows, for the demand */
  followed(): EventKind[]
}

export const passes = (e: SessionEvent, f: Filter): boolean => (!f.kinds || f.kinds.has(e.kind)) && (!f.project || e.project === f.project) && (!f.scope || f.scope(e))

export function eventLog(session: string): EventLog {
  const kept: SessionEvent[] = []
  const subs = new Set<{ f: Filter; fn: (e: SessionEvent) => void }>()
  let seq = 0
  const next = () => cursorOf(session, seq)
  return {
    push(kind, project, data, by = null) {
      const e = { id: cursorOf(session, ++seq), t: Date.now(), kind, project, by, data }
      kept.push(e as SessionEvent)
      if (kept.length > KEEP) kept.shift()
      for (const s of [...subs]) if (passes(e as SessionEvent, s.f)) s.fn(e as SessionEvent)
      return e
    },
    since(cursor, f = {}) {
      if (cursor === null) return { events: [], next: next() }
      const c = parseCursor(cursor)
      const n = c?.seq ?? NaN
      const floor = seq - kept.length
      const keep = (es: SessionEvent[]) => es.filter(e => passes(e, f))
      // a cursor of the old `<session>.<seq>` form is no cursor of this session either
      if (!c || c.session !== session || n > seq) return { events: keep(kept), reset: 'another session', next: next() }
      if (n < floor) return { events: keep(kept), reset: 'below the floor', next: next() }
      return { events: keep(kept.slice(n - floor)), next: next() }
    },
    subscribe(f, fn) {
      const s = { f, fn }
      subs.add(s)
      return () => void subs.delete(s)
    },
    next,
    followed() {
      const out = new Set<EventKind>()
      for (const s of subs) for (const k of s.f.demand ?? s.f.kinds ?? EVENT_KINDS) out.add(k)
      return [...out]
    },
  }
}

/** The ranges an edit changed: the common prefix and suffix of the two texts left out, in the text before. */
export function changedRanges(before: string, after: string): EditRange[] {
  if (before === after) return []
  const r = textDoc(before).siteOf(diffEdit(before, after))
  return [{ start: [r.line, r.col], end: [r.endLine, r.endCol] }]
}
