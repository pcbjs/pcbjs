// The tiers of an edit as data and a pure scheduler over them, docs/session.md: given a project's edits, its demand and the time,
// which job its runtime runs next. Slots are named by their entry file; the scheduler never reads a file or a clock.
import type { View } from '@pcbjs/core/internal/plugin'
import type { TierName, Tiers } from '@pcbjs/core/protocol'

/** ms a write on disk waits for the watcher's other events before it compiles */
export const GATHER_MS = 60

/** What each slot's observers want: its views, null for every one; a slot absent from it is observed by no one. */
export type Demand = ReadonlyMap<string, readonly View[] | null>

export interface Tier {
  name: TierName
  /** minimum sketch interval, or ms of quiet before a full compile */
  after: number
  runs: 'sketch' | 'compile'
  /** the views it compiles of a slot, null for every one, none for a slot no one observes */
  views(d: Demand, slot: string): readonly View[] | null
  /** a run of every view of every slot mints a snapshot */
  commits: boolean
}

/** The keystroke tier sketches the edited entity for the views of its layers, the quiet tier compiles what is observed, a query every view. */
export function tiers(t: Tiers): Record<TierName, Tier> {
  return {
    keystroke: {
      name: 'keystroke',
      after: t.keystroke,
      runs: 'sketch',
      views: (d, s) => (d.has(s) && (d.get(s) ?? ['layers']).includes('layers') ? ['layers'] : []),
      commits: false,
    },
    quiet: { name: 'quiet', after: t.quiet, runs: 'compile', views: (d, s) => (d.has(s) ? d.get(s)! : []), commits: true },
    query: { name: 'query', after: 0, runs: 'compile', views: () => null, commits: true },
  }
}

export interface Edit {
  /** null for an edit that names no file, such as a file added */
  file: string | null
  /** the slots whose boards it reaches */
  slots: string[]
  /** an editor's text, which waits for typing to pause and may hold; else a write on disk or a text applied, which waits for the watcher alone */
  typed: boolean
}

/** The keystroke tier of a typed file. */
export interface Sketch {
  tier: Tier
  file: string
  slots: string[]
}

/** A compile of some slots, each for its views; `edits` what it compiles, whose typed texts apply first unless their block holds. */
export interface Run {
  tier: Tier
  slots: string[]
  views: ReadonlyMap<string, readonly View[] | null>
  edits: Edit[]
  /** slots it compiles for no edit: a demand, a query, a cancelled run's rest */
  wanted: string[]
}

export type Job = Sketch | Run

export const isRun = (j: Job): j is Run => j.tier.runs === 'compile'

export interface Scheduler {
  /** an edit; true when it stops the running compile */
  edit(e: Edit, now: number): boolean
  /** what the observers want now: a slot compiled for fewer views compiles for the rest */
  demand(d: Demand, now: number): void
  /** a query: every slot not current, and `extra`, compiles every view next */
  query(extra?: string[]): void
  /** the job due at `now`, a run marked running; null when none */
  next(now: number): Job | null
  /** when the next job falls due, null when none waits */
  due(): number | null
  /** a run ended: `left` the slots a cancel stopped, which wait for the next, `partial` those compiled for some views with the views now current */
  done(run: Run, r: { left: string[]; partial: ReadonlyMap<string, ReadonlySet<View>> }): void
  /** the slots of the project changed, a config reload: every one is fresh */
  reset(slots: string[]): void
  running(): Run | null
  /** a run runs or one waits */
  busy(): boolean
  /** slots no full compile reached since their files changed, with the views compiled for them */
  unseen(): ReadonlyMap<string, ReadonlySet<View>>
  /** slots never compiled */
  fresh(): ReadonlySet<string>
}

export function scheduler(slots: string[], tiers: Record<TierName, Tier>): Scheduler {
  let all = [...slots]
  let fresh = new Set(slots)
  const unseen = new Map<string, ReadonlySet<View>>()
  let edits: Edit[] = []
  let wanted = new Set<string>()
  let quietAt: number | null = null
  let asked = false
  let extra: string[] = []
  let running: Run | null = null
  let demand: Demand = new Map()
  const sketches = new Map<string, { at: number; slots: string[] }>()
  const sketched = new Map<string, number>()

  const merge = (e: Edit) => {
    const was = edits.find(x => x.file === e.file)
    if (!was) edits.push({ ...e, slots: [...e.slots] })
    else {
      was.slots = [...new Set([...was.slots, ...e.slots])]
      // the latest says whether an editor's text waits to apply
      was.typed = e.typed
    }
  }
  const pending = () => new Set([...wanted, ...edits.flatMap(e => e.slots)])
  const take = (tier: Tier, slots: string[], more: Iterable<string>): Run => {
    const views = new Map(slots.map(s => [s, tier.views(demand, s)] as const))
    const want = new Set([...wanted, ...more])
    const run: Run = { tier, slots, views, edits, wanted: slots.filter(s => want.has(s)) }
    edits = []
    wanted = new Set()
    quietAt = null
    running = run
    return run
  }
  const quiet = (): Run => {
    const waiting = pending()
    const observed = all.filter(s => waiting.has(s) && tiers.quiet.views(demand, s)?.length !== 0)
    // what no one observes goes stale until a view or a query asks
    for (const s of waiting) if (!observed.includes(s) && !fresh.has(s)) unseen.set(s, unseen.get(s) ?? new Set())
    return take(tiers.quiet, observed, [])
  }
  const asking = (): Run => {
    const more = new Set([...fresh, ...unseen.keys(), ...extra])
    const slots = new Set([...pending(), ...more])
    asked = false
    extra = []
    return take(
      tiers.query,
      all.filter(s => slots.has(s)),
      more,
    )
  }

  return {
    edit(e, now) {
      merge(e)
      // the keystroke tier reaches a typed file's viewers only
      if (e.typed && e.file && e.slots.some(s => demand.has(s)))
        sketches.set(e.file, { at: Math.max(now, (sketched.get(e.file) ?? -Infinity) + tiers.keystroke.after), slots: e.slots })
      quietAt = now + (e.typed ? tiers.quiet.after : GATHER_MS)
      return !!running
    },
    demand(d, now) {
      demand = d
      const lacks = (s: string, has: ReadonlySet<View>) => d.has(s) && (d.get(s)?.some(v => !has.has(v)) ?? true)
      const lacking = [...unseen].filter(([s, has]) => lacks(s, has))
      if (!lacking.length) return
      for (const [s] of lacking) wanted.add(s)
      quietAt = Math.min(quietAt ?? Infinity, now + GATHER_MS)
    },
    query(more = []) {
      asked = true
      extra = [...extra, ...more]
    },
    next(now) {
      for (const [file, k] of sketches)
        if (k.at <= now) {
          sketches.delete(file)
          sketched.set(file, now)
          return { tier: tiers.keystroke, file, slots: k.slots }
        }
      if (running) return null
      if (asked) return asking()
      if (quietAt !== null && quietAt <= now) return quiet()
      return null
    },
    due() {
      const times = [...sketches.values()].map(k => k.at)
      if (!running && asked) times.push(-Infinity)
      if (!running && quietAt !== null) times.push(quietAt)
      return times.length ? Math.min(...times) : null
    },
    done(run, r) {
      if (running === run) running = null
      for (const s of run.slots) {
        if (r.left.includes(s)) continue
        fresh.delete(s)
        const has = r.partial.get(s)
        if (has) unseen.set(s, has)
        else unseen.delete(s)
      }
      for (const s of r.left) wanted.add(s)
    },
    reset(slots) {
      all = [...slots]
      fresh = new Set(slots)
      unseen.clear()
      edits = []
      wanted = new Set()
      sketches.clear()
      sketched.clear()
      quietAt = null
    },
    running: () => running,
    busy: () => !!running || asked || quietAt !== null,
    unseen: () => unseen,
    fresh: () => fresh,
  }
}
