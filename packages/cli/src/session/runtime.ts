// One loaded project as the session runs it, docs/session.md: its slots and compile thread, its scheduler of the tiers, its snapshots,
// the facets its viewers hold, and the compile events every report of a compile follows. Runtimes share nothing but the session's
// drafts and snapshots, so two projects compile at once and a query on one never waits for another's route.
import { relative, resolve, sep } from 'node:path'
import { fileKey, sameFile, under } from '../project/files.js'
import { readFileSync } from 'node:fs'
import type { RouteProgress } from '@pcbjs/compile'
import { demanded, STAGES } from '@pcbjs/compile/internal/pipeline'
import type { View } from '@pcbjs/core/internal/plugin'
import type { Board } from '@pcbjs/core/model'
import { FACET_NAMES, facetHash, splitSite } from '@pcbjs/core/site-facets'
import type { CompileEvent, Invalidate, Run as RunId, Stale, Tiers } from '@pcbjs/core/protocol'
import { entriesReaching, markConflicts, slotName, type BoardSlot, type ModuleLookup } from '../project/boards.js'
import type { Artifact, Compiler, Held } from '../project/compiler.js'
import type { ResolvedConfig } from '../project/config.js'
import { strip, errorText, errorTrace } from '../project/errors.js'
import { holdIn, type Drafts } from './drafts.js'
import type { StageStatus } from '../project/facets.js'
import type { BoardOut, Compiled, Preview } from '../project/project.js'
import { referenceFiles } from '../project/references.js'
import type { Scope, ScopeBoards } from './scope-state.js'
import { changedSince, stampFiles } from './scopes.js'
import { facetStore, type FacetStore } from './facet-store.js'
import { affected as staleSet, changedSpans, editedIn, type Edit as Changed } from '../project/invalidate.js'
import { isRun, scheduler, tiers, type Demand, type Run, type Sketch } from './scheduler.js'
import { changedFiles, changedOnDisk, compiledAsNow, sha, staleOf, type Now, type Snapshot, type Snapshots } from './snapshots.js'
import { disk as diskText } from './sources.js'
import { workerCompiler } from './worker-client.js'

type Slot = BoardSlot<Held>

export interface RuntimeHooks {
  /** the session's snapshots, of every project */
  snaps: Snapshots
  tiers: Tiers
  drafts(): Drafts | null
  /** apply the editor's texts of `files` unless their block holds; resolves with the files held */
  settle(files: string[]): Promise<Set<string>>
  /** a write under an editor's text that a query's scan found before the watcher */
  shadow(file: string): void
  /** the viewers of this project now; with none the keystroke tier and the invalidates have no one to go to */
  viewers(): number
  invalidated(inv: Invalidate): void
  /** the events of the edits a snapshot compiled go before its compile events */
  flushFeed(): void
  watch(files: string[]): void
  log(msg: string): void
  closing(): boolean
  /** the dev server's own files, which no project reaches */
  clientDir: string
}

export interface ProjectRuntime {
  readonly scope: Scope
  readonly root: string
  readonly cfg: ResolvedConfig
  readonly state: ScopeBoards
  readonly facets: FacetStore
  compiler(): Compiler
  graph(): ModuleLookup
  /** whether the project's compile reads the file, or would: under its root, in its module graph or a referenced board's files */
  reaches(file: string): boolean
  /** an edit of a file, null for one that names none; `typed` an editor's text that waits for typing to pause */
  edit(file: string | null, typed: boolean): void
  /** what its observers want, per slot */
  demand(d: Demand): void
  /** a draft of the project began or stopped holding the compile */
  held(file: string, line: number | null): void
  /** compile what was never compiled or only for some views, every view of it */
  compiledOnce(): Promise<void>
  /** settle before answer: wait for the files to stop changing, compile what changed, answer within `ms` */
  settle(ms: number): Promise<{ snap: Snapshot | null; stale: Stale | null }>
  refresh(entries: string[], policy: 'stages' | 'all' | 'warm', ms: number): Promise<void>
  snapshotStale(snap: Snapshot): Stale | null
  /** Current placement geometry for an advisory read, without requesting missing checks. */
  lockModel(name: string, view: 'pcb' | 'sch'): Board | null
  current(): Snapshot | null
  previous(): Snapshot | null
  hold(): { file: string; line: number } | null
  artifact<K extends Artifact>(c: Held, kind: K): Promise<Compiled[K]>
  /** a compile runs or one waits */
  busy(): boolean
  /** resolves once the running compile ended */
  idle(): Promise<void>
  /** slots whose board is older than their files */
  stale(): boolean
  /** a file's isolated preview, null when its default export shows nothing */
  preview(abs: string, rel: string): Promise<Preview | null>
  /** the scope's files moved under the watcher since its last compile: they compile again */
  catchUp(): void
  on(fn: (e: CompileEvent) => void): () => void
  close(): Promise<void>
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
/** A path relative to a project root, as it is when outside it. */
export const relTo = (root: string, f: string) => (under(f, root) ? relative(root, f).split(sep).join('/') : f)

/** True when `p` settles before the deadline, a time in ms. */
async function within(p: Promise<unknown>, deadline: number): Promise<boolean> {
  let t: NodeJS.Timeout | undefined
  const late = new Promise<boolean>(r => (t = setTimeout(() => r(false), Math.max(0, deadline - Date.now()))))
  try {
    return await Promise.race([
      p.then(
        () => true,
        () => true,
      ),
      late,
    ])
  } finally {
    clearTimeout(t)
  }
}

/** The views whose stages a compile of `want` runs in full; every view without one. */
const viewsOf = (want: readonly View[] | undefined): Set<View> => {
  const plan = demanded(want ? [...want] : undefined)
  return new Set(FACET_NAMES.filter(v => [...demanded([v])].every(n => plan.has(n))))
}
/** A slot's views as the compile thread takes them: undefined for every one, as when they need every stage. */
const wantOf = (v: readonly View[] | null | undefined): View[] | undefined => (!v || demanded([...v]).size === STAGES.length ? undefined : [...v])

export function projectRuntime(scope: Scope, hooks: RuntimeHooks): ProjectRuntime {
  const cfg = scope.cfg!
  const root = cfg.root
  const state = scope.state!
  const sched = scheduler(
    state.slots.map(s => s.entry.file),
    tiers(hooks.tiers),
  )
  const facets = facetStore()
  const lastGood = new Map<string, Held[]>()
  const lockModels = new Map<string, { boards: Held[]; views: Set<View>; inputs: Pick<Snapshot, 'stamps' | 'overlay'> }>()
  const listeners = new Set<(e: CompileEvent) => void>()
  const emit = (e: CompileEvent) => {
    for (const fn of [...listeners]) fn(e)
  }
  let demand: Demand = new Map()
  let closed = false
  let timer: NodeJS.Timeout | null = null
  // the end of the running run, and the queries waiting for one to finish
  let ended: Promise<void> = Promise.resolve()
  let asked: (() => void)[] = []
  // edits that stopped this project's compiles, so a run knows it went stale; invalidates sent, so a sketch knows it did
  let cancels = 0
  let invalidates = 0
  let previewDirty = false
  let refreshQueue: Promise<void> = Promise.resolve()
  const rebuilds = new Map<string, 'stages' | 'all' | 'warm'>()

  const drafts = () => hooks.drafts()
  const compiler = (): Compiler => {
    if (state.compiler) return state.compiler
    const c = workerCompiler({ root, configFile: scope.configFile ?? cfg.configFile ?? '', entries: scope.entries, log: hooks.log })
    for (const f of drafts()?.files() ?? []) {
      const d = drafts()!.get(f)!
      c.draft(f, { code: d.code, limit: d.limit })
    }
    return (state.compiler = c)
  }
  // nothing compiled yet, nothing reached: the compile thread is made by the first compile
  const graph = (): ModuleLookup => state.compiler?.graph() ?? { getModulesByFile: () => undefined }
  const imported = (file: string) => state.compiler?.imported(file) ?? new Set([file])
  const referencedBy = (s: Slot, file: string) => !!s.compiled && referenceFiles(s.compiled).some(f => sameFile(f, file))
  const referenced = (file: string) => state.slots.some(s => referencedBy(s, file))
  const own = (file: string) => under(file, root) && !under(file, hooks.clientDir) && !fileKey(file).includes('/.pcbjs/') && !fileKey(file).includes('/node_modules/')
  // every board without a file; one that failed last time is always affected
  const affected = (file: string | null): Slot[] => {
    const slots = state.slots
    if (!file) return slots
    const hit = entriesReaching(
      graph().getModulesByFile(file),
      slots.map(s => s.entry.file),
    )
    // a referenced board's file is in no module graph here
    if (!hit) return referenced(file) ? slots.filter(s => referencedBy(s, file) || !s.compiled || s.error || s.conflict) : slots
    return slots.filter(s => hit.has(s.entry.file) || !s.compiled || s.error || s.conflict || referencedBy(s, file))
  }

  const draftFiles = (file: string) => {
    const d = drafts()
    if (!d?.files().length) return []
    const graph = imported(file)
    return d.files().filter(f => [...graph].some(g => sameFile(g, f)))
  }
  const markDraft = (cs: BoardOut[], file: string) => {
    const files = draftFiles(file)
    const skipped = files.reduce((n, f) => n + (drafts()?.get(f)?.skipped.length ?? 0), 0)
    for (const c of cs) {
      if (files.length) c.site.draft = { skipped }
      else delete c.site.draft
    }
  }
  /** The meta hash again after a draft or stale mark, which the compile thread never saw. */
  const remeta = (c: Held) => {
    if (c.site.draft || c.site.stale) c.hashes.meta = facetHash(splitSite(c.site).meta)
  }

  const current = () => hooks.snaps.current(root)
  // the files a compile read: its module graph, config and referenced boards
  const projectFiles = (): Set<string> => {
    const out = new Set<string>(cfg.configFile ? [cfg.configFile] : [])
    for (const sl of state.slots) {
      for (const f of imported(sl.entry.file)) if (!fileKey(f).includes('/node_modules/') && !f.startsWith('\0')) out.add(f)
      for (const f of referenceFiles(sl.compiled ?? [])) out.add(f)
    }
    return out
  }
  const overlayNow = () => new Map((drafts()?.files() ?? []).map(f => [f, sha(drafts()!.get(f)!.text)]))
  // what a compile starts from: the stamps of the files it read last time and the unsaved text it gets now
  const inputsOf = (slots: Slot[]) => {
    const stamps = stampFiles(projectFiles())
    for (const s of state.slots) {
      if (slots.includes(s)) continue
      for (const f of new Set([...imported(s.entry.file), ...(s.stamps?.keys() ?? [])])) {
        const before = scope.stamps.get(f)
        if (before !== undefined) stamps.set(f, before)
      }
    }
    return { stamps, overlay: overlayNow() }
  }
  /** The source texts as compiled: a draft's, else the last snapshot's while its file kept its stamp, else the disk's. */
  const textsOf = (files: Set<string>, stamps: Map<string, string>) => {
    const out = new Map<string, string>()
    const was = current()
    for (const f of files) {
      if (!under(f, root) || !/\.[cm]?[jt]sx?$/.test(f)) continue
      const text = drafts()?.get(f)?.text ?? (was && !was.overlay.has(f) && was.stamps.get(f) === stamps.get(f) ? was.texts.get(f) : undefined)
      try {
        out.set(f, text ?? readFileSync(f, 'utf8'))
      } catch {
        /* gone since */
      }
    }
    return out
  }
  /** One snapshot per finished compile, holding every board of the project, compiled now or before. */
  const commit = (inputs: ReturnType<typeof inputsOf>, run: RunId): Snapshot => {
    const files = projectFiles()
    const stamps = new Map([...inputs.stamps].filter(([f]) => files.has(f)))
    for (const [f, s] of stampFiles([...files].filter(f => !stamps.has(f)))) stamps.set(f, s)
    return hooks.snaps.commit(
      {
        project: root,
        slots: state.slots.map(s => ({ entry: s.entry, compiled: s.error ? null : s.compiled, error: s.error ? (s.failure ?? s.error) : null, conflict: s.conflict })),
        stamps,
        overlay: new Map([...inputs.overlay].filter(([f]) => files.has(f))),
        texts: textsOf(files, stamps),
      },
      run,
    )
  }
  // the watcher follows the files of the last compile, so an edit of any reaches this project
  const track = (stamps: Map<string, string>) => {
    const watched = (f: string) => !fileKey(f).includes('/node_modules/') && !fileKey(f).includes('/.pcbjs/') && !under(f, hooks.clientDir) && !f.startsWith('\0')
    const files = new Set([...projectFiles()].filter(watched))
    if (state.preview) for (const f of imported(state.preview.file)) if (watched(f)) files.add(f)
    scope.files = [...files]
    const discovered = stampFiles(scope.files.filter(f => !stamps.has(f)))
    scope.stamps = new Map(scope.files.map(f => [f, stamps.get(f) ?? discovered.get(f)!]))
    hooks.watch(scope.files)
  }

  const busy = () => sched.busy()
  const nowOf = (): Now => ({ overlay: f => overlayNow().get(f) ?? null, pending: busy() })
  /** An edit stops the running compile at its next cancel point, and nothing more of it reaches a viewer. */
  const stop = () => {
    cancels++
    state.compiler?.cancel()
  }

  /** Run what is due, and wake when the next job is. */
  const pump = () => {
    if (closed || hooks.closing()) return
    for (let job = sched.next(Date.now()); job; job = sched.next(Date.now())) {
      if (isRun(job)) ended = run(job)
      else void sketch(job).catch(e => hooks.log(`keystroke tier: ${strip(String(e?.message ?? e)).split('\n')[0]}`))
    }
    if (timer) clearTimeout(timer)
    const at = sched.due()
    timer = at === null ? null : setTimeout(pump, Math.max(0, at - Date.now()))
  }

  /** A quiet run of edits a query compiled already: the current snapshot compiled every edited file as it is now and every slot is current. */
  const served = (r: Run, slots: Slot[]): boolean => {
    const snap = current()
    const files = r.edits.map(e => e.file)
    if (!snap || !files.length || files.includes(null) || r.wanted.length) return false
    if (slots.some(s => !s.compiled || s.error || sched.unseen().has(s.entry.file))) return false
    const now = nowOf()
    return files.every(f => compiledAsNow(snap, f!, now))
  }

  /** One run of the scheduler: the editor's texts it waited for applied, unless their block holds, then its slots compiled for their views. */
  const run = async (r: Run): Promise<void> => {
    const left: string[] = []
    const partial = new Map<string, Set<View>>()
    try {
      const epoch = cancels
      const typed = r.edits.filter(e => e.typed && e.file).map(e => e.file!)
      const held = typed.length ? await hooks.settle(typed) : new Set<string>()
      // what only a held text reaches waits for the hold to end
      const need = new Set([...r.wanted, ...r.edits.filter(e => !(e.file && held.has(e.file))).flatMap(e => e.slots)])
      const slots = state.slots.filter(s => r.slots.includes(s.entry.file) && need.has(s.entry.file))
      if (cancels !== epoch) left.push(...slots.map(s => s.entry.file))
      else if (slots.length && !(r.tier.name === 'quiet' && served(r, slots))) {
        invalidate(slots)
        const out = await compileSlots(slots, r)
        left.push(...out.left)
        for (const [k, v] of out.partial) partial.set(k, v)
      }
    } catch (e: any) {
      // the run ends all the same, so the scheduler never waits on it
      hooks.log(`a compile of ${root} stopped: ${strip(String(e?.message ?? e)).split('\n')[0]}`)
    }
    sched.done(r, { left, partial })
    scope.stale = sched.unseen().size > 0
    if (previewDirty) {
      previewDirty = false
      void refreshPreview()
    }
    if (r.tier.name === 'query' && !left.length) {
      for (const done of asked.splice(0)) done()
    } else if (r.tier.name === 'query') sched.query()
    pump()
  }

  /** The slots of a run, each for its views; what a cancel stopped is `left`, a slot compiled for some views `partial`. */
  const compileSlots = async (slots: Slot[], r: Run): Promise<{ left: string[]; partial: Map<string, Set<View>> }> => {
    const done: Slot[] = []
    const partial = new Map<string, Set<View>>()
    const inputs = inputsOf(slots)
    const c = compiler()
    const id = hooks.snaps.reserve()
    let cancelled = false
    // an edit since the compile began: nothing more of it reaches a viewer
    const epoch = cancels
    const live = () => cancels === epoch
    const left: string[] = []
    emit({ t: 'requested', project: root, run: id, tier: r.tier.name, entries: slots.map(s => s.entry.rel), cause: causeOf(r) })
    for (const [i, s] of slots.entries()) {
      if (hooks.closing()) break
      const entry = s.entry.rel
      const want = s.error ? undefined : wantOf(r.views.get(s.entry.file))
      emit({
        t: 'started',
        project: root,
        run: id,
        entry,
        name: s.compiled && !s.conflict ? slotName(s) : null,
        done: i,
        total: slots.length,
        stages: STAGES.filter(n => demanded(want).has(n)),
      })
      const progress = ({ done, legs, round }: RouteProgress) => {
        if (legs && live()) emit({ t: 'stage', project: root, run: id, entry, stage: 'autoroute', state: 'running', ms: 0, units: [done, legs], ...(round ? { round } : {}) })
      }
      const stage = (st: StageStatus) => {
        if (live()) emit({ t: 'stage', project: root, run: id, entry, stage: st.name, state: st.state, ms: st.ms, ...(st.units ? { units: st.units } : {}) })
      }
      try {
        const out = await c.compile(s.entry, {
          draft: draftFiles(s.entry.file).length > 0,
          rebuild: rebuilds.get(s.entry.file),
          progress,
          stage,
          ...(want ? { want } : {}),
          // the stages stream their facets while the project has viewers; the finished board reaches the store whatever
          ...(hooks.viewers() > 0 ? { facet: f => live() && emit({ t: 'facet', project: root, facet: { ...f, run: id } }) } : {}),
        })
        if (!live()) {
          cancelled = true
          left.push(...slots.slice(i).map(x => x.entry.file))
          break
        }
        lockModels.set(s.entry.file, { boards: out, views: viewsOf(want), inputs: { ...inputs, stamps: new Map([...stampFiles(out.flatMap(c => c.files)), ...inputs.stamps]) } })
        if (out[0]?.partial) {
          partial.set(s.entry.file, viewsOf(want))
          continue
        }
        rebuilds.delete(s.entry.file)
        s.compiled = out
        lastGood.set(s.entry.file, out)
        markDraft(s.compiled, s.entry.file)
        s.compiled.forEach(remeta)
        s.error = null
        s.failure = undefined
        // a board served from the cache has no module graph, so its stamps come from the files its compile read
        s.stamps = stampFiles(s.compiled[0].files.filter(f => !fileKey(f).includes('/node_modules/') && !f.startsWith('\0')).concat(referenceFiles(s.compiled)))
        // referenced boards compile in their own process, so the watcher follows their files here
        if (referenceFiles(s.compiled).length) hooks.watch(referenceFiles(s.compiled))
        s.doneAt = Date.now()
        done.push(s)
      } catch (e: any) {
        lockModels.delete(s.entry.file)
        if (e?.name === 'CancelledError' || !live()) {
          cancelled = true
          left.push(...slots.slice(i).map(x => x.entry.file))
          break
        }
        rebuilds.delete(s.entry.file)
        failed(s, e, id)
      }
    }
    markConflicts(state.slots)
    if (live() && !cancelled)
      for (const s of done) if (!s.conflict) for (const t of s.compiled!) for (const facet of facets.reconcile(t, id)) emit({ t: 'facet', project: root, facet })
    // a run of every view of its slots, with no other slot older than its files or never compiled, mints a snapshot
    const others = state.slots.filter(s => !slots.includes(s)).map(s => s.entry.file)
    const whole = r.tier.commits && !partial.size && others.every(k => !sched.unseen().has(k) && !sched.fresh().has(k))
    const committed = live() && !cancelled && whole && !hooks.closing()
    if (committed) hooks.flushFeed()
    const snap = committed ? commit(inputs, id) : null
    track(snap?.stamps ?? inputs.stamps)
    if (cancelled) {
      hooks.log(`an edit cancelled the compile of ${slots.map(s => s.entry.rel).join(', ')}; it compiles again`)
      emit({ t: 'cancelled', project: root, run: id, entries: slots.map(s => s.entry.rel) })
    } else
      emit({
        t: 'committed',
        project: root,
        run: id,
        snapshot: snap?.id ?? null,
        entries: done.map(s => s.entry.rel),
        partial: slots.filter(s => partial.has(s.entry.file)).map(s => s.entry.rel),
      })
    return { left, partial }
  }
  const causeOf = (r: Run): string[] => [...r.edits.map(e => (e.file ? relTo(root, e.file) : 'added')), ...(r.wanted.length ? [r.tier.name === 'query' ? 'query' : 'demand'] : [])]
  /** A failed board shows its current source prefix, or explicitly falls back to stale geometry. */
  const failed = (s: Slot, e: any, run: RunId) => {
    s.compiled = e?.preview?.length ? e.preview : (lastGood.get(s.entry.file) ?? (s.compiled?.some(c => c.site.halted) ? null : s.compiled))
    const display = errorText(e, false, root)
    s.error = [display.line, ...display.detail].join('\n')
    s.failure = e
    const message = display.line
    if (s.compiled)
      for (const c of s.compiled) {
        c.site.stale = !c.site.halted
        c.site.staleError = message
        remeta(c)
        for (const facet of facets.reconcile(c, run)) emit({ t: 'facet', project: root, facet })
      }
    emit({
      t: 'failed',
      project: root,
      run,
      entry: s.entry.rel,
      name: s.compiled && !s.conflict ? slotName(s) : null,
      message,
      stack: errorTrace(e, root).join('\n'),
      text: s.error,
    })
  }

  /** `pcbjs:invalidate` per board target: what the edits since the last snapshot make stale in it, `typed` a keystroke tier's text of a file newer than its draft. Every facet of a run up to `edit`, the newest reserved, is stale for the viewers. */
  const invalidate = (slots: Slot[], typed?: { file: string; text: string }) => {
    const snap = current()
    if (!snap || !hooks.viewers()) return
    invalidates++
    const now = nowOf()
    const files = changedFiles(snap, typed ? { ...now, overlay: f => (f === typed.file ? sha(typed.text) : now.overlay(f)) } : now)
    const edits = files.map((abs): Changed => {
      const before = snap.texts.get(abs)
      const after = abs === typed?.file ? typed.text : (drafts()?.get(abs)?.text ?? diskText(abs))
      return { abs, rel: relTo(root, abs), spans: before === undefined || after === null ? null : changedSpans(before, after) }
    })
    if (!edits.length) return
    const edit = hooks.snaps.last()
    for (const s of slots)
      for (const c of snap.slots.find(sl => sl.entry.file === s.entry.file)?.compiled ?? []) hooks.invalidated({ ...staleSet(c, snap.run, edits), ...(edit ? { edit } : {}) })
  }

  /** The keystroke tier, docs/session.md: the edit's affected set half-opaque at once, then the edited entity redrawn from the text as typed, for the viewers of its layers. */
  const sketch = async (job: Sketch) => {
    const start = performance.now()
    const d = await drafts()?.sketch(job.file)
    if (process.env.PCBJS_DEBUG_SKETCH) hooks.log(`sketch prepare ${(performance.now() - start).toFixed(1)} ms`)
    const snap = current()
    if (!d || !snap || !hooks.viewers()) return
    const file = job.file
    const slots = affected(file).filter(s => s.compiled && !s.error && !s.conflict)
    // the edit is the viewers' from here: the sketch of the one before stops, and anything of it is dropped
    state.compiler?.cancelSketch()
    invalidate(slots, { file, text: d.text })
    const before = snap.texts.get(file)
    if (before === undefined) return
    const epoch = invalidates
    const rel = relTo(root, file)
    for (const s of slots) {
      if (!job.tier.views(demand, s.entry.file)?.length) continue
      const c = snap.slots.find(sl => sl.entry.file === s.entry.file)?.compiled?.[0]
      if (!c) continue
      // the entity as the viewers hold it, hidden while its sketch stands in
      const old = editedIn(c.site.sources?.[rel] ?? [], changedSpans(before, d.text))
      for (const it of c.board.items) if (it.ref && it.uid && old.refs.has(it.ref)) old.uids.add(it.uid)
      const replaces = [...old.uids].sort()
      const base = c.board.items.reduce((m, it) => Math.max(m, it.id), 0) + 1
      const run = hooks.snaps.reserve()
      try {
        const spans = changedSpans(d.text, before)
        // typed back to the text the viewers hold: an empty sketch clears the last one
        const sk = spans.length
          ? await compiler().sketch(s.entry, { file, code: d.code, spans, base })
          : { board: c.board.name, ...(c.board.variant ? { target: c.board.variant.name } : {}), data: { layers: [], items: [] } }
        if (!sk || invalidates !== epoch) return
        emit({
          t: 'facet',
          project: root,
          facet: {
            board: sk.board,
            ...(sk.target !== undefined ? { target: sk.target } : {}),
            facet: 'layers',
            stage: 'keystroke',
            run,
            hash: facetHash(sk.data),
            data: sk.data,
            partial: { replaces },
          },
        })
      } catch (e: any) {
        // a draft that evaluates with an error waits for the full tier to say so
        if (e?.name !== 'CancelledError') hooks.log(`keystroke tier of ${rel}: ${strip(String(e?.message ?? e)).split('\n')[0]}`)
        return
      }
    }
  }

  /** A query: every slot not current compiles every view, with every slot when there is no snapshot to answer from. */
  const query = (extra: string[] = []): Promise<void> => {
    const p = new Promise<void>(r => asked.push(r))
    sched.query(extra)
    pump()
    return p
  }
  // two scans 50 ms apart that agree, 1 s at most
  const steady = async () => {
    const scan = () => JSON.stringify([[...stampFiles(projectFiles())], [...overlayNow()]])
    let a = scan()
    for (let t = 0; t < 1000; t += 50) {
      await sleep(50)
      const b = scan()
      if (a === b) return
      a = b
    }
  }
  const settle = async (ms: number): Promise<{ snap: Snapshot | null; stale: Stale | null }> => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline && !hooks.closing()) {
      const snap = current()
      // a held draft compiles for a query as the repair makes it
      if (!staleOf(snap, nowOf()) && !holdIn(drafts(), root)) return { snap, stale: null }
      if (sched.running()) {
        await within(ended, deadline)
        continue
      }
      await steady()
      if (sched.running() || current() !== snap) continue
      // stamping catches a write the watcher has not reported yet, and one under an editor's text
      for (const f of snap ? changedOnDisk(snap) : []) hooks.shadow(f)
      await drafts()?.flush()
      if (sched.running() || current() !== snap) continue
      const files = snap ? changedFiles(snap, nowOf()) : []
      if (snap && !files.length && !sched.fresh().size && !sched.unseen().size && !holdIn(drafts(), root)) {
        if (!busy()) return { snap, stale: null }
        await sleep(50)
        continue
      }
      compiler().changed(files)
      for (const f of files) sched.edit({ file: f, slots: affected(f).map(s => s.entry.file), typed: false }, Date.now())
      const before = current()
      // with no snapshot to answer from, or nothing found that moved, every board compiles
      if (!(await within(query(snap && files.length ? [] : state.slots.map(s => s.entry.file)), deadline))) break
      if (current() === before) await sleep(50)
    }
    return { snap: current(), stale: { reason: 'timeout' } }
  }

  const refreshPreview = async () => {
    const pv = state.preview
    if (!pv) return
    const next = await preview(pv.file, pv.rel)
    if (next && state.preview === pv) state.preview = next
  }
  const preview = async (abs: string, rel: string): Promise<Preview | null> => {
    try {
      const out = await compiler().preview(abs, rel)
      if (out) markDraft([out.compiled], abs)
      if (!out) hooks.log(`no preview for ${rel}: its default export is not a <PCB>, a part, a circuit instance or a layout`)
      return out
    } catch (e: any) {
      hooks.log(`no preview for ${rel}: ${strip(String(e?.message ?? e)).split('\n')[0]}`)
      return null
    }
  }

  return {
    scope,
    root,
    cfg,
    state,
    facets,
    compiler,
    graph,
    reaches: file => own(file) || scope.files.some(f => sameFile(f, file)) || [...(graph().getModulesByFile(file) ?? [])].length > 0 || referenced(file),
    edit(file, typed) {
      const pv = state.preview
      if (pv && (!file || sameFile(file, pv.file) || entriesReaching(graph().getModulesByFile(file), [pv.file])?.size)) previewDirty = true
      stop()
      const slots = affected(file).map(s => s.entry.file)
      if (typed && file && slots.some(s => demand.has(s) && (demand.get(s) ?? ['layers']).includes('layers')))
        void drafts()
          ?.sketch(file)
          .catch(e => hooks.log(`draft preparation: ${String(e)}`))
      sched.edit({ file, slots, typed }, Date.now())
      pump()
    },
    demand(d) {
      demand = d
      sched.demand(d, Date.now())
      pump()
    },
    held: (file, line) => emit({ t: 'held', project: root, file, line }),
    async compiledOnce() {
      if (sched.fresh().size || sched.unseen().size) await query()
    },
    settle,
    refresh(entries, policy, ms) {
      const run = async () => {
        const selected = entries.length ? state.slots.filter(s => entries.some(e => sameFile(resolve(root, e), s.entry.file))) : state.slots
        if (entries.some(e => !selected.some(s => sameFile(resolve(root, e), s.entry.file)))) throw new Error('rebuild entries must name configured entries')
        const before = await settle(ms)
        if (!before.snap || before.stale) throw new Error('cannot rebuild a stale snapshot; run check again')
        for (const s of selected) rebuilds.set(s.entry.file, policy)
        if (!(await within(query(selected.map(s => s.entry.file)), Date.now() + ms))) throw new Error('rebuild timed out')
        const after = await settle(ms)
        if (after.stale || selected.some(s => rebuilds.has(s.entry.file))) throw new Error('rebuild did not finish; run check again')
      }
      const next = refreshQueue.then(run, run)
      refreshQueue = next.catch(() => {})
      return next
    },
    snapshotStale: snap => staleOf(snap, nowOf()),
    lockModel(name, view) {
      for (const [entry, model] of lockModels) {
        if (!state.slots.some(s => s.entry.file === entry && !s.error && !s.conflict) || changedFiles(model.inputs, nowOf()).length) {
          lockModels.delete(entry)
          continue
        }
        if (busy() || !model.views.has(view === 'sch' ? 'sch' : 'layers')) continue
        const board = model.boards.find(c => c.board.name === name && (!c.board.variant || c.board.variant.index === 0))?.board
        if (board) return board
      }
      return null
    },
    current,
    previous: () => hooks.snaps.previous(root),
    hold: () => holdIn(drafts(), root),
    artifact: (c, kind) => {
      if (c.site.halted) return Promise.reject(new Error('Compilation halted; finish the board before exporting artifacts'))
      return compiler().artifact(c.run, c.board.name, c.board.variant?.name ?? null, kind)
    },
    busy,
    idle: () => ended,
    stale: () => sched.unseen().size > 0,
    preview,
    catchUp() {
      for (const [file, stamp] of stampFiles(scope.stamps.keys())) {
        if (scope.stamps.get(file) === stamp) continue
        scope.stamps.set(file, stamp)
        state.compiler?.changed([file])
        this.edit(file, false)
      }
    },
    on(fn) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    async close() {
      closed = true
      lockModels.clear()
      if (timer) clearTimeout(timer)
      stop()
      for (const done of asked.splice(0)) done()
      await state.compiler?.close()
      state.compiler = undefined
    },
  }
}
