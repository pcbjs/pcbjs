// The session around its projects, docs/session.md: the runtime of each loaded project, the scope the editor focused last, the editor's
// drafts with their repair and hold, the language servers and the sources they share, the connections and the events log, the
// viewers and what each one observes, and the projections of every runtime's compile events onto all of them.
import { sameFile, under } from '../project/files.js'
import { realpathSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ViteDevServer } from 'vite'
import { freezeEdits } from '@pcbjs/compile/internal/freeze'
import type { View } from '@pcbjs/core/internal/plugin'
import { FACET_NAMES, type FacetName } from '@pcbjs/core/site-facets'
import type { By, CompileEvent, Events, FocusEvent, LoadStatus, Observe, ScopesMsg, StateMsg } from '@pcbjs/core/protocol'
import { boardFindings, boardLine, counts, diffFindings, diffText, formatFindings, routingLines, type Finding } from '@pcbjs/export/internal/findings'
import type { BoardSource, DocRole, EditorEvents, EditorSelection, Holder, Host } from '@pcbjs/lsp'
import { boardsPayload, focusTarget, ideBoards, liveSlots, slotName } from '../project/boards.js'
import { normalizeFile } from '../server/bridge.js'
import { errorText, strip } from '../project/compile.js'
import { drafts as draftsOf, holdIn, skippedRanges, tiersOf, type Drafts, type Hold } from './drafts.js'
import { lspHub, LSP_VERSION, type LspHub } from './lsp.js'
import { previewable, type DevState, type ProjectApi, type ProjectsApi } from './plugin.js'
import { loadScope, scopeRoute, scopesInfo, type Scope, type Workspace } from './scope-state.js'
import { changedSince, scopeOf } from './scopes.js'
import { clientsOf, type Client } from './clients.js'
import { eventLog, type EventLog } from './events.js'
import { eventFeed } from './feed.js'
import { facetFrame, wants } from './facet-store.js'
import { projectRuntime, relTo, type ProjectRuntime } from './runtime.js'
import type { Demand } from './scheduler.js'
import { boardKey, snapshots, type Snapshot } from './snapshots.js'
import { disk as diskText, sources as sourcesOf, type Sources } from './sources.js'
import { nextStatus, PROGRESS_MS } from './status.js'

/** ms between heartbeats, `session/state` to every connection */
const BEAT_MS = 5000

/** What the viewer tools give the language servers: the assist, the grid and completion lights, and the editor's selections. */
export type ToolHooks = Pick<EditorEvents, 'assist' | 'endFocus' | 'grid'> & {
  close(file: string): void
  drop(root: string): void
  select(file: string, boards: EditorSelection[], key: unknown, by: By | null): void
  /** an editor attached or left */
  editorsChanged(): void
  /** a connection attached or left: the viewers that may write learn the agents */
  agentsChanged(): void
  /** a connection said hello: a viewer gets the status and its first compile starts */
  greeted(c: Client): void
}

export interface Hub {
  readonly server: ViteDevServer
  readonly ws: Workspace
  readonly shared: DevState
  readonly sources: Sources
  lsp(): LspHub | null
  drafts(): Drafts | null
  events(): EventLog | undefined
  log(level: 'info' | 'warn' | 'error', msg: string): void
  muted(msg: string): void
  toEditors<E extends keyof Events>(event: E, data: Events[E]): void
  runtimes(): ProjectRuntime[]
  /** a scope's runtime, loading its config on first use; null when it fails to load */
  load(sc: Scope): Promise<ProjectRuntime | null>
  /** the scope the editor focused or a page opened last, loaded; what an editor pane with no scope of its own shows */
  show(sc: Scope): Promise<ProjectRuntime | null>
  /** a scope no longer served: its runtime stops */
  drop(sc: Scope): Promise<void>
  /** the runtime of the scope shown last, else of the only one */
  recent(): ProjectRuntime | null
  /** the root of a connection's project: the scope a viewer observes, the project its hello names, else the one shown last or the first */
  projectOf(c: Client): string | null
  /** the runtime of a connection's project */
  runtimeOfClient(c: Client): ProjectRuntime | null
  /** the runtime holding a file, by its real path */
  runtimeOfFile(file: string): ProjectRuntime | null
  /** the root of the scope a page request came from, by its referrer, else the scope shown last */
  rootOfRequest(req: IncomingMessage): string
  /** the viewer pages that said what they show, every project's */
  viewers(): (Client & { observe: Observe })[]
  /** the viewers of a project, of one board of it when named */
  viewersOf(root: string, board?: string): (Client & { observe: Observe })[]
  /** an event to the viewers of a project, of one board when named */
  sendTo<E extends keyof Events>(root: string, event: E, data: Events[E], board?: string): void
  status(root: string | null): LoadStatus
  payload(rt: ProjectRuntime): Events['pcbjs:boards']
  workspaceInfo(): ScopesMsg
  announce(): void
  previewPage(): { url: string; scope: string | null } | null
  scopeUrl(sc: Scope): string | null
  /** a write on disk the watcher reported */
  changed(file: string): boolean
  /** a file added or removed */
  added(file: string): void
  /** what every runtime's observers want, again */
  demand(): void
  focus(file: string, by?: By | null): Promise<void>
  /** the focus as one viewer gets it */
  focusFor(c: Client): FocusEvent | null
  closeFile(file: string): void
  stateOf(project: string): StateMsg
  beatTo(c: Client): void
  /** the language servers start with the viewer tools' hooks; the connections, the drafts and the feed are made here too */
  attach(tools: ToolHooks): void
  api(): ProjectsApi
  realOf(file: string): string
}

export function sessionHub(server: ViteDevServer, ws: Workspace, shared: DevState, clientDir: string): Hub {
  let lsp: LspHub | null = null
  const toEditors = <E extends keyof Events>(event: E, data: Events[E]) => shared.clients?.relay(event, data)
  /** A line of the dev log, which every editor gets too. */
  const log = (level: 'info' | 'warn' | 'error', msg: string) => {
    server.config.logger[level](`[pcbjs] ${msg}`, { timestamp: true })
    toEditors('pcbjs:ide:log', { level, text: strip(`[pcbjs] ${msg}`).trim() })
  }
  const muted = (msg: string) => log('info', msg)
  const snaps = () => (shared.snapshots ??= snapshots(shared.session.id))
  const realOf = (f: string) => {
    try {
      return realpathSync.native(f)
    } catch {
      return f
    }
  }

  // --- runtimes and the scope shown last

  const runtimes = new Map<Scope, ProjectRuntime>()
  let toolHooks: ToolHooks | null = null
  let loading: Promise<unknown> = Promise.resolve()
  const recent = (): ProjectRuntime | null => {
    const sc = ws.recent ?? (ws.scopes.length === 1 ? ws.scopes[0] : null)
    return sc ? (runtimes.get(sc) ?? null) : null
  }
  const runtimeOfFile = (file: string) => {
    const sc = scopeOf(ws.scopes, file)
    return sc ? (runtimes.get(sc) ?? null) : null
  }
  const rootOf = (f: string) => scopeOf(ws.scopes, f)?.dir ?? null
  const ready = (sc: Scope) => sc.status === 'ready'
  /** Loading swaps the realm of the process, so loads go one at a time. */
  const load = async (sc: Scope): Promise<ProjectRuntime | null> => {
    const job = loading.then(async () => {
      if (sc.status !== 'unloaded') return
      await loadScope(sc, line => muted(line.replace(/^pcbjs: /, '')))
      if (!ready(sc)) log('error', `${sc.slug}: ${sc.error}`)
    })
    loading = job.catch(() => {})
    await job
    if (sc.status !== 'ready') {
      announce()
      return null
    }
    // a session closing starts no compile thread that would keep its process up
    return runtimes.get(sc) ?? (shared.closing ? null : start(sc))
  }
  const start = (sc: Scope): ProjectRuntime => {
    const rt = projectRuntime(sc, {
      snaps: snaps(),
      tiers: (shared.tiers ??= tiersOf()),
      drafts: () => shared.drafts ?? null,
      settle: async files => new Set((await Promise.all(files.map(async f => ((await shared.drafts?.settle(f)) ? [f] : [])))).flat()),
      shadow: f => shadow(f),
      viewers: () => viewersOf(rt.root).length,
      invalidated: inv => sendTo(rt.root, 'pcbjs:invalidate', inv, inv.board),
      flushFeed: () => shared.feed?.flush(),
      watch: files => server.watcher.add(files),
      log: muted,
      closing: () => !!shared.closing,
      clientDir,
    })
    runtimes.set(sc, rt)
    rt.on(projections(rt))
    rt.demand(demandOf(rt))
    announce()
    return rt
  }
  const configChanged = (rt: ProjectRuntime) => {
    const file = rt.scope.configFile,
      stamp = rt.scope.stamps.get(file)
    return !!stamp && changedSince(new Map([[file, stamp]]))
  }
  const show = async (sc: Scope): Promise<ProjectRuntime | null> => {
    let rt = await load(sc)
    if (!rt) return null
    if (configChanged(rt)) {
      await reload(sc)
      rt = await load(sc)
      if (!rt) return null
    }
    rt.catchUp()
    // a scope shown compiles what it never compiled or no one observed, every view of it
    void rt.compiledOnce()
    if (ws.recent === sc) return rt
    const prev = ws.recent ? runtimes.get(ws.recent) : null
    ws.recent = sc
    // the focused file's own preview is the scope's it was made in
    if (prev?.state.preview) prev.state.preview = null
    muted(`showing ${sc.rel || sc.slug} at ${scopeRoute(ws, sc)}`)
    toEditors('pcbjs:ide:scope', { scope: sc.slug, root: sc.dir, route: scopeRoute(ws, sc), url: scopeUrl(sc) })
    toEditors('pcbjs:ide:boards', hostBoards(rt))
    lsp?.preview(previewPage())
    announce()
    // an observer of every stage follows the editor
    demand()
    return rt
  }
  /** A scope no longer served: its runtime stops. */
  const drop = async (sc: Scope) => {
    const rt = runtimes.get(sc)
    toolHooks?.drop(sc.dir)
    runtimes.delete(sc)
    if (ws.recent === sc) ws.recent = null
    await rt?.close()
  }
  /** A config edit: the scope loads again with it, at once while someone observes it. */
  const reload = async (sc: Scope) => {
    const rt = runtimes.get(sc)
    if (!rt) return
    toolHooks?.drop(rt.root)
    runtimes.delete(sc)
    const observed = !!viewersOf(rt.root).length || ws.recent === sc
    await rt.close()
    sc.status = 'unloaded'
    sc.stale = true
    announce()
    if (observed) await (await load(sc))?.compiledOnce()
  }

  // --- viewers

  const projectOf = (c: Client): string | null => {
    const slug = c.observe?.scope
    if (slug !== undefined) return ws.scopes.find(x => x.slug === slug)?.dir ?? null
    const project = c.hello?.project
    if (project !== undefined) {
      const root = realOf(project)
      const sc = ws.scopes.find(x => sameFile(x.dir, root))
      if (sc) return sc.dir
      // a workspace-root editor follows its sidebar's shown scope; an explicit viewer scope never falls back
      if (c.hello?.role === 'editor' && ws.folders.some(f => sameFile(f, root))) return recent()?.root ?? ws.scopes[0]?.dir ?? null
      return null
    }
    return recent()?.root ?? ws.scopes[0]?.dir ?? null
  }
  /** The viewer pages that said what they show. */
  const viewers = () => (shared.clients?.list() ?? []).filter((c): c is Client & { observe: Observe } => c.hello?.role === 'viewer' && !!c.observe)
  const viewersOf = (root: string, board?: string) => viewers().filter(c => projectOf(c) === root && (!board || c.observe.board === null || c.observe.board === board))
  const sendTo = <E extends keyof Events>(root: string, event: E, data: Events[E], board?: string) => {
    for (const c of viewersOf(root, board)) c.event(event, data)
  }
  const byRoot = (root: string | null) => (root ? ([...runtimes.values()].find(r => sameFile(r.root, root)) ?? null) : null)
  const runtimeOfClient = (c: Client) => byRoot(projectOf(c))

  // an observer of every stage: a language client, an editor connection, a findings or compile subscriber, pcbjs dev; it follows the scope shown last
  const everything = (rt: ProjectRuntime) =>
    rt === recent() &&
    (!!lsp?.servers().length ||
      !!shared.events?.followed().some(k => k === 'findings' || k === 'compile') ||
      !!shared.clients?.list().some(c => c.hello?.role === 'editor' || c.hello?.capabilities.includes('findings')))
  /** Each slot's views: those of the viewers of its board, every one for an observer of every stage. */
  const demandOf = (rt: ProjectRuntime): Demand => {
    const out = new Map<string, View[] | null>()
    const all = everything(rt)
    const peers = viewersOf(rt.root)
    for (const s of rt.state.slots) {
      if (all) {
        out.set(s.entry.file, null)
        continue
      }
      const name = s.compiled && !s.conflict ? slotName(s) : null
      const mine = peers.filter(p => !name || p.observe.board === null || p.observe.board === name)
      if (!mine.length) continue
      const has = new Set<FacetName>(mine.flatMap(p => p.observe.facets))
      out.set(
        s.entry.file,
        FACET_NAMES.filter(f => has.has(f)),
      )
    }
    return out
  }
  const demand = () => {
    for (const rt of runtimes.values()) rt.demand(demandOf(rt))
  }

  // --- what viewers and editors are told

  const statuses = new Map<string, LoadStatus>()
  const status = (root: string | null): LoadStatus => (root && statuses.get(root)) || { phase: 'starting' }
  const payload = (rt: ProjectRuntime) => ({
    ...boardsPayload(rt.state.slots, rt.state.preview?.compiled),
    ...(ws.scopes.length > 1 ? { scope: rt.scope.slug } : {}),
    run: rt.current()?.run ?? null,
  })
  const hostBoards = (rt: ProjectRuntime) => ({ ...ideBoards(rt.state.slots), ...(ws.scopes.length > 1 ? { scope: rt.scope.slug } : {}), root: rt.root })
  const workspaceInfo = (): ScopesMsg => {
    for (const [sc, rt] of runtimes) sc.stale = rt.stale()
    const i = scopesInfo(ws)
    return { single: i.single, displayed: i.displayed, scopes: i.scopes }
  }
  const announce = () => {
    const i = workspaceInfo()
    for (const c of viewers()) c.event('pcbjs:scopes', i)
    toEditors('pcbjs:ide:scopes', i)
  }
  const scopeUrl = (sc: Scope): string | null => {
    const addr = server.httpServer?.address()
    if (!addr || typeof addr !== 'object') return null
    const u = server.resolvedUrls?.local?.[0] ?? `http://localhost:${addr.port}/`
    return new URL(scopeRoute(ws, sc), u).href
  }
  const previewPage = () => {
    const sc = recent()?.scope
    if (sc) {
      const url = scopeUrl(sc)
      return url ? { url, scope: ws.scopes.length > 1 ? sc.slug : null } : null
    }
    const addr = server.httpServer?.address()
    if (!addr || typeof addr !== 'object') return null
    return { url: server.resolvedUrls?.local?.[0] ?? `http://localhost:${addr.port}/`, scope: null }
  }
  const invalidateVirtual = () => {
    const g = server.environments.client?.moduleGraph
    const m = g?.getModuleById('\0virtual:pcbjs/board')
    if (m) g!.invalidateModule(m)
  }

  // --- the heartbeat

  /** The heartbeat of a project, every 5 s and after each snapshot or hold: what a view must hold, so it can tell it fell out of sync. */
  const stateOf = (project: string): StateMsg => {
    const rt = byRoot(project)
    const snap = snaps().current(project)
    return { project, run: snap?.run ?? null, facets: snap?.facets ?? {}, pending: !!rt?.busy(), hold: holdIn(shared.drafts, project), tiers: (shared.tiers ??= tiersOf()) }
  }
  const beatTo = (c: Client) => {
    const root = projectOf(c)
    if (root) c.event('session/state', stateOf(root))
  }
  /** The heartbeat to every connection, or to those of one project. */
  const beat = (project?: string) => {
    for (const c of shared.clients?.list() ?? []) if (c.hello && (!project || projectOf(c) === project)) beatTo(c)
  }
  const beating = setInterval(() => {
    for (const rt of runtimes.values()) {
      if (!viewersOf(rt.root).length || rt.busy()) continue
      if (configChanged(rt)) void reload(rt.scope)
      else rt.catchUp()
    }
    beat()
  }, BEAT_MS)
  beating.unref()
  server.httpServer?.once('close', () => clearInterval(beating))

  // --- the projections of each runtime's compile events

  /** Everything a compile tells, read off its runtime's stream: the status, the facets, the run's end, the events log and the dev log. */
  const projections = (rt: ProjectRuntime) => {
    const parts = [statusOf(rt), facetsOf(rt), endOf(rt), eventsOf(), devLog(rt)]
    return (e: CompileEvent) => {
      for (const fn of parts) fn(e)
    }
  }
  const statusOf = (rt: ProjectRuntime) => {
    let sentAt = 0
    return (e: CompileEvent) => {
      const next = nextStatus(status(rt.root), e)
      if (!next) return
      statuses.set(rt.root, next.status)
      if (!next.moved && performance.now() - sentAt <= PROGRESS_MS) return
      sentAt = performance.now()
      sendTo(rt.root, 'pcbjs:status', next.status)
    }
  }
  const facetsOf = (rt: ProjectRuntime) => (e: CompileEvent) => {
    if (e.t !== 'facet') return
    // a sketch stands in for the entity until the next compile, so it is never held for a resend
    if (!e.facet.partial && !rt.facets.put(e.facet)) return
    for (const c of viewersOf(rt.root)) if (wants(c.observe, e.facet)) c.post(facetFrame(e.facet))
  }
  const endOf = (rt: ProjectRuntime) => (e: CompileEvent) => {
    if (e.t === 'held') beat(e.project)
    if (e.t !== 'committed' && e.t !== 'cancelled') return
    if (e.t === 'committed') {
      sendTo(rt.root, 'pcbjs:boards', payload(rt))
      if (rt === recent()) toEditors('pcbjs:ide:boards', hostBoards(rt))
      // a board compiled for the first time has a name its viewers observe it by
      rt.demand(demandOf(rt))
    }
    announce()
    invalidateVirtual()
    if (e.t === 'committed' && e.snapshot) {
      lsp?.refresh(e.project)
      beat(e.project)
    }
  }
  /** The events log's `compile` and `findings`: a run started or cancelled, a hold, and once a run minted a snapshot each stage done and the findings delta of each board and target. */
  const eventsOf = () => {
    let before: Snapshot | null = null
    const broken = new Map<number, string[]>()
    return (e: CompileEvent) => {
      const log = shared.events
      if (!log) return
      if (e.t === 'requested') log.push('compile', e.project, { state: 'started', run: e.run, tier: e.tier, entries: e.entries })
      else if (e.t === 'held' && e.line !== null) log.push('compile', e.project, { state: 'held', file: e.file, line: e.line, snapshot: snaps().current(e.project)?.id ?? null })
      else if (e.t === 'failed') broken.set(e.run, [...(broken.get(e.run) ?? []), e.entry])
      else if (e.t === 'cancelled') {
        broken.delete(e.run)
        log.push('compile', e.project, { state: 'cancelled', run: e.run })
      } else if (e.t === 'committed') {
        const failed = broken.get(e.run) ?? []
        broken.delete(e.run)
        const snap = e.snapshot ? snaps().get(e.snapshot) : null
        if (!snap) return
        compiledEvents(log, snap, before, e.entries, failed)
        before = snap
      }
    }
  }
  const compiledEvents = (log: EventLog, snap: Snapshot, before: Snapshot | null, entries: string[], failed: string[]) => {
    const project = snap.project
    for (const entry of failed) log.push('compile', project, { snapshot: snap.id, stage: 'evaluate', entry, ok: false, ms: 0, cached: false })
    const boards = snap.slots.filter(s => entries.includes(s.entry.rel) && !s.conflict).flatMap(s => s.compiled ?? [])
    for (const c of boards)
      for (const st of c.stages)
        log.push('compile', project, {
          snapshot: snap.id,
          stage: st.name,
          board: c.board.name,
          target: c.board.variant?.name ?? null,
          ok: true,
          ms: Math.round(st.ms * 10) / 10,
          cached: !!st.hit,
        })
    for (const c of boards) {
      const k = boardKey(c)
      const d = diffFindings(before?.findings.get(k) ?? [], snap.findings.get(k) ?? [])
      const n = counts(c.board)
      log.push('findings', project, {
        snapshot: snap.id,
        board: c.board.name,
        target: c.board.variant?.name ?? null,
        added: d.added.map(f => f.id),
        resolved: d.fixed.map(f => f.id),
        errors: n.drcErrors + n.ercErrors,
        warnings: n.drcWarnings + n.ercWarnings,
        unconnected: n.unconnected,
        drc: { errors: n.drcErrors, warnings: n.drcWarnings },
        erc: { errors: n.ercErrors, warnings: n.ercWarnings },
      })
    }
  }
  /** The dev log: each board compiled with its findings and their change, each failure, and a compile of some views. */
  const devLog = (rt: ProjectRuntime) => {
    const last = new Map<string, Finding[]>()
    const slotOf = (entry: string) => rt.state.slots.find(s => s.entry.rel === entry)
    return (e: CompileEvent) => {
      if (e.t === 'failed') {
        const t = errorText(slotOf(e.entry)?.failure ?? e.message, shared.verbose, rt.root)
        log('error', `${e.name ?? e.entry}: ${t.line}${t.detail.map(l => `\n  ${l}`).join('')}${e.name ? '\n  the viewer keeps the last good board, marked stale' : ''}`)
        sendTo(rt.root, 'pcbjs:error', { name: e.name, entry: e.entry, message: e.message, stack: e.stack, text: e.text })
      }
      if (e.t !== 'committed') return
      for (const entry of e.entries) {
        const s = slotOf(entry)
        if (s?.conflict) {
          log('error', `${entry}: ${s.conflict}`)
          sendTo(rt.root, 'pcbjs:error', { name: null, entry, message: s.conflict, stack: '', text: s.conflict })
        } else if (s?.compiled) muted(report(s.compiled, entry, rt.root, last))
      }
      for (const entry of e.partial) muted(`${entry}: compiled for the views shown; the rest compiles when a view or a query needs it`)
    }
  }
  const report = (compiled: { board: Parameters<typeof boardLine>[0]; entry: { rel: string }; ms: number }[], entry: string, root: string, last: Map<string, Finding[]>) => {
    const lines: string[] = []
    const targets: { target?: string; findings: Finding[] }[] = []
    let added = 0,
      fixed = 0,
      unchanged = 0,
      seen = false
    for (const c of compiled) {
      const b = c.board
      lines.push(boardLine(b, c.entry.rel, c.ms))
      const f = boardFindings(b, root)
      targets.push({ target: b.variant?.name, findings: f })
      const key = `${b.name}|${b.variant?.name ?? ''}`
      const prev = last.get(key)
      if (prev) {
        seen = true
        const d = diffFindings(prev, f)
        added += d.added.length
        fixed += d.fixed.length
        unchanged += d.unchanged
      }
      last.set(key, f)
    }
    lines.push(...routingLines(compiled.map(c => c.board)))
    lines.push(...formatFindings(targets, { cap: 5, more: `all in pcbjs check ${entry}` }))
    if (seen) lines.push(`  since the last compile: ${diffText(added, fixed, unchanged)}`)
    return lines.join('\n')
  }

  // --- edits: on disk, typed, released

  /** A write on disk: a config reloads its scope, any other file reaches each runtime whose compile reads it; false when none does. */
  const changed = (file: string): boolean => {
    const sc = scopeOf(ws.scopes, file)
    if (sc && sameFile(file, sc.configFile) && sc.status !== 'unloaded') {
      void reload(sc)
      return true
    }
    let hit = false
    for (const rt of runtimes.values())
      if (rt.reaches(file)) {
        rt.edit(file, false)
        hit = true
      }
    return hit || !!sc
  }
  const added = (file: string) => {
    for (const rt of runtimes.values()) rt.state.compiler?.changed([file])
    shared.feed?.written(file)
    const sc = scopeOf(ws.scopes, file)
    if (sc && sameFile(file, sc.configFile)) return void reload(sc)
    for (const rt of runtimes.values()) if (under(file, rt.root) && !under(file, clientDir)) rt.edit(null, false)
  }
  const typed = (file: string) => {
    const reached = [...runtimes.values()].filter(rt => rt.reaches(file))
    for (const rt of reached) rt.edit(file, true)
    // no project reads it: its text applies at once, with no tier to wait for
    if (!reached.length) void shared.drafts?.settle(file)
  }
  const released = (file: string) => {
    for (const rt of runtimes.values()) if (rt.reaches(file)) rt.edit(file, false)
  }

  // --- the focus and the isolated preview

  let lastFocus: { abs: string; rel: string; root: string; isolated: boolean; by?: By | null } | null = null
  let focusSeq = 0
  /** The focus as a viewer showing `board` of the focused project gets it, the board of the focused file else. */
  const focusEvent = (f: NonNullable<typeof lastFocus>, current: string | null): FocusEvent | null => {
    const rt = byRoot(f.root)
    if (!rt) return null
    const scope = ws.scopes.length > 1 ? { scope: rt.scope.slug } : {}
    if (f.isolated) {
      const pv = rt.state.preview
      if (!pv || pv.file !== f.abs) return null
      const name = pv.compiled.board.name
      return { board: name, entry: null, boards: [name], file: f.rel, isolated: true, ...scope, ...(f.by ? { by: f.by } : {}) }
    }
    return { ...focusTarget(rt.graph(), rt.state.slots, f.abs, current), file: f.rel, ...scope, ...(f.by ? { by: f.by } : {}) }
  }
  const shownBoard = (c: Client, f: NonNullable<typeof lastFocus>) => (projectOf(c) === f.root ? (c.observe?.board ?? null) : null)
  const focusFor = (c: Client) => (lastFocus ? focusEvent(lastFocus, shownBoard(c, lastFocus)) : null)
  /** The focus to every viewer, computed once per board shown; a viewer that never observed gets it as for no board. */
  const sendFocus = () => {
    if (!lastFocus) return
    const byBoard = new Map<string, FocusEvent | null>()
    for (const c of viewers()) {
      const board = shownBoard(c, lastFocus)
      const k = board ?? '\0'
      if (!byBoard.has(k)) byBoard.set(k, focusEvent(lastFocus, board))
      const e = byBoard.get(k)
      if (e) c.event('pcbjs:focus', e)
    }
  }
  const dropPreview = (rt: ProjectRuntime, why: string) => {
    if (!rt.state.preview) return
    muted(`preview of ${rt.state.preview.rel} closed (${why})`)
    rt.state.preview = null
    sendTo(rt.root, 'pcbjs:boards', payload(rt))
    lsp?.refresh(rt.root)
  }
  // the board whose tree holds the file, else the isolated preview of its default export, else nothing
  const focus = async (file: string, by: By | null = null) => {
    const seq = ++focusSeq
    // the scopes are real paths, as Vite names files; an editor may name the file through a symbolic link
    const real = realOf(normalizeFile(recent()?.root ?? ws.folders[0], file).abs)
    const sc = scopeOf(ws.scopes, real)
    if (!sc) return
    const rt = await show(sc)
    if (seq !== focusSeq || !rt) return
    const { abs, rel } = normalizeFile(rt.root, real)
    await rt.compiledOnce()
    if (seq !== focusSeq) return
    if (focusTarget(rt.graph(), rt.state.slots, abs).entry) {
      lastFocus = { abs, rel, root: rt.root, isolated: false, by }
      sendFocus()
      if (rt.state.preview) dropPreview(rt, 'focus moved to a board')
      return
    }
    if (!previewable(rt.root, abs)) return
    if (rt.state.preview?.file !== abs) {
      const pv = await rt.preview(abs, rel)
      if (seq !== focusSeq || !pv) return
      rt.state.preview = pv
      muted(`preview of ${rel}: ${pv.kind}, ${pv.compiled.board.stats.footprints} footprints`)
      sendTo(rt.root, 'pcbjs:boards', payload(rt))
      lsp?.refresh(rt.root)
    }
    lastFocus = { abs, rel, root: rt.root, isolated: true, by }
    sendFocus()
  }
  const closeFile = (file: string) => {
    const rt = runtimeOfFile(realOf(file))
    if (rt && rt.state.preview && sameFile(rt.state.preview.file, normalizeFile(rt.root, file).abs)) dropPreview(rt, 'file closed')
  }

  // --- sources, shadows and restored buffers

  // a disk write under an editor's unsaved text: the text stays, compiled in place of the file, until the editor saves
  const shadowed = new Map<string, { named: string; at: number }>()
  const shadow = (file: string) => {
    const doc = sources.read(file)
    if (doc?.holder?.role !== 'editor' || doc.authority !== 'editor' || diskText(file) === doc.text) return
    if (!shared.drafts?.get(file)) shared.drafts?.set(file, doc.text, doc.named)
    if (shadowed.has(file)) return
    shadowed.set(file, { named: doc.named, at: Date.now() })
    const root = rootOf(file) ?? recent()?.root ?? ws.folders[0]
    const rel = relTo(root, file)
    const editor = doc.holder.name ?? 'an editor'
    shared.feed?.shadowed(file, by => {
      shared.events?.push('edit', root, { file: rel, source: by ? 'agent' : 'disk', ranges: null, shadowed: true }, by)
      muted(`${rel} changed on disk${by ? ` by ${by.name}` : ''} under the unsaved text of ${editor}; the session compiles the editor's text until it saves, reverts or merges`)
    })
    lsp?.refresh()
  }
  const unshadow = (file: string, text: string | null) => {
    if (!shadowed.has(file) || (text !== null && diskText(file) !== text)) return
    shadowed.delete(file)
    lsp?.refresh()
  }
  // which text of a file is true, and the one path that writes it
  const sources = sourcesOf({
    hub: () => lsp,
    rootOf: f => rootOf(f) ?? recent()?.root ?? ws.folders[0],
    projectOf: k => (k as Client)?.hello?.project ?? null,
    claim: (f, by) => shared.feed?.claim(f, by),
  })
  // the session's watcher reaches every compile thread, and finds what it wrote under an editor
  server.watcher.on('change', file => {
    for (const rt of runtimes.values()) rt.state.compiler?.changed([file])
    const doc = sources.read(file)
    // a write under an editor's text is a shadow or the editor's own save, never an edit of its own
    if (doc?.authority !== 'editor' || doc.holder?.role !== 'editor') shared.feed?.written(file)
    if (doc?.authority === 'editor') {
      shadow(file)
      unshadow(file, doc.text)
    }
  })
  server.watcher.on('add', added)
  server.watcher.on('unlink', file => {
    const rt = runtimeOfFile(file)
    if (rt?.state.preview && sameFile(rt.state.preview.file, file)) dropPreview(rt, 'file deleted')
    added(file)
  })

  // --- the projects as queries see them

  const apiOf = (rt: ProjectRuntime): ProjectApi => ({
    root: rt.root,
    cfg: rt.cfg,
    current: rt.current,
    previous: rt.previous,
    settle: rt.settle,
    refresh: rt.refresh,
    snapshotStale: rt.snapshotStale,
    hold: rt.hold,
    artifact: rt.artifact,
  })
  const api = (): ProjectsApi => ({
    async find(at) {
      const file = at ? realOf(normalizeFile(recent()?.root ?? ws.folders[0], at).abs) : null
      const sc = (file ? scopeOf(ws.scopes, file) : null) ?? (at ? null : (recent()?.scope ?? ws.scopes[0]))
      const rt = sc ? await load(sc) : null
      return rt ? apiOf(rt) : null
    },
    store: () => lsp?.store() ?? null,
    sources: () => sources,
  })

  const attach = (tools: ToolHooks) => {
    toolHooks = tools
    shared.events ??= eventLog(shared.session.id)
    shared.feed = eventFeed({ log: () => shared.events, projectOf: rootOf, disk: diskText })
    server.httpServer?.once('close', () => shared.feed?.dispose())
    const boards = (only?: string) => {
      const out: { root: string; site: import('@pcbjs/export/internal/site-data').SiteData }[] = []
      for (const rt of runtimes.values()) {
        if (only && rt.root !== only) continue
        for (const sl of liveSlots(rt.state.slots)) for (const c of sl.compiled!) out.push({ root: rt.root, site: c.site })
        if (rt.state.preview) out.push({ root: rt.root, site: rt.state.preview.compiled.site })
      }
      return out
    }
    const source: BoardSource = {
      boards,
      preview: previewPage,
      skipped: () => skippedRanges(shared.drafts),
      placements: (file, text) => {
        const placed = boards().flatMap(b => (b.site.placed ?? []).filter(p => p.src && sameFile(join(b.root, p.src.file), file)))
        return placed.length ? { lines: placed.map(p => p.src!.line), edits: freezeEdits(file, text, placed).edits } : null
      },
      shadowed: () =>
        [...shadowed.values()].map(v => ({
          file: v.named,
          message: `changed on disk at ${new Date(v.at).toLocaleTimeString()} under your unsaved text; the session compiles your text until you save, revert or merge`,
        })),
    }
    // a connection's focus and cursor name it; a read-only one serves its own positions and never syncs into the store
    const clientOf = (key: unknown): Client | null => (shared.clients?.get((key as Client)?.id) === key ? (key as Client) : null)
    const roleOf = (key: unknown): { role: DocRole; name?: string } => {
      const c = clientOf(key)
      if (!c) return { role: 'editor', name: 'editor' }
      return { role: c.mode === 'ro' ? 'reader' : c.hello?.role === 'agent' ? 'agent' : 'editor', name: c.by().name }
    }
    // who an event came through: a connection, else the language server's own holder
    const byOfKey = (key: unknown): By | null => clientOf(key)?.by() ?? null
    const byOfHolder = (h: Holder): By => byOfKey(lsp?.keyOf(h.id)) ?? { client: h.id, name: h.name ?? h.id, ...(h.role === 'agent' ? { role: 'agent' as const } : {}) }
    const host: Host = { version: LSP_VERSION, quiet: (shared.tiers ??= tiersOf()).quiet, source }
    lsp = lspHub(host, {
      eventsOf: (key): EditorEvents => {
        const by = byOfKey(key)
        return {
          close: file => {
            tools.close(file)
            closeFile(file)
          },
          assist: tools.assist,
          endFocus: tools.endFocus,
          grid: tools.grid,
          focus: f => void focus(f, by),
          cursor: (f, line, col) => {
            const abs = realOf(normalizeFile(recent()?.root ?? ws.folders[0], f).abs)
            shared.feed?.cursor(abs, line, col, by)
            shared.drafts?.cursor(abs, line, col)
          },
          select: (f, b) => tools.select(f, b, key, by),
        }
      },
      roleOf,
      log: muted,
      // the store feeds the drafts, which feed every compile
      onStore: st =>
        st.onChange(c => {
          if (shared.drafts?.set(c.file, c.doc?.text ?? null, c.named)) typed(c.file)
          unshadow(c.file, c.doc?.text ?? null)
          if (c.doc) shared.feed?.synced(c.file, c.doc.text, byOfHolder(c.by), c.by.role === 'agent' ? 'agent' : 'editor')
        }),
      onNotify: (key, msg) => {
        // the flush goes after the notification, which reaches the server once this returns
        if (msg.method === 'initialized')
          queueMicrotask(
            () =>
              void lsp?.flush(key).then(() => {
                tools.editorsChanged()
                demand()
              }),
          )
        const uri = msg.method === 'textDocument/didSave' ? msg.params?.textDocument?.uri : undefined
        if (typeof uri === 'string' && uri.startsWith('file:')) shared.feed?.saved(realOf(fileURLToPath(uri)), byOfKey(key))
      },
    })
    server.httpServer?.once('close', () => {
      lsp?.dispose()
      lsp = null
    })
    shared.clients = clientsOf({
      info: () => ({ session: shared.session.id, edit: shared.session.edit, token: shared.session.token }),
      ready: () => {
        const r = shared.ready?.()
        return r ? { ...r, projects: shared.projects?.() ?? [] } : null
      },
      hub: () => lsp,
      methods: () => shared.session.handlers,
      attach: root => shared.session.attach?.(root),
      greeted: tools.greeted,
      log: muted,
      onChange: () => {
        shared.session.onChange?.()
        demand()
        tools.agentsChanged()
        tools.editorsChanged()
      },
    })
    server.httpServer?.once('close', () => shared.clients?.close())
    // the save itself drops the draft; each compile thread gets it, and one made later gets every draft
    shared.drafts = draftsOf(
      f => {
        const d = shared.drafts?.get(f)
        for (const rt of runtimes.values()) rt.state.compiler?.draft(f, d ? { code: d.code, limit: d.limit } : null)
      },
      {
        typeError: (f, text, start, end) => lsp?.typeError(f, text, start, end) ?? null,
        changed: (file: string, h: Hold | null) => {
          const rt = runtimeOfFile(file)
          if (rt) rt.held(relTo(rt.root, file), h?.line ?? null)
        },
        released,
      },
    )
    shared.wake = demand
    shared.api = api()
    server.httpServer?.once('close', () => {
      shared.drafts?.dispose()
      shared.drafts = null
      for (const rt of runtimes.values()) void rt.close()
    })
  }

  return {
    server,
    ws,
    shared,
    sources,
    lsp: () => lsp,
    drafts: () => shared.drafts ?? null,
    events: () => shared.events,
    log,
    muted,
    toEditors,
    runtimes: () => [...runtimes.values()],
    load,
    show,
    drop,
    recent,
    projectOf,
    runtimeOfClient,
    runtimeOfFile,
    rootOfRequest(req) {
      const ref = req.headers.referer
      const path = ref ? new URL(ref).pathname : ''
      const sc = ws.scopes.find(s => ws.scopes.length > 1 && path.startsWith(`/${encodeURIComponent(s.slug)}/`))
      return sc?.dir ?? recent()?.root ?? ws.scopes[0]?.dir ?? ws.folders[0]
    },
    viewers,
    viewersOf,
    sendTo,
    status,
    payload,
    workspaceInfo,
    announce,
    previewPage,
    scopeUrl,
    changed,
    added,
    demand,
    focus,
    focusFor,
    closeFile,
    stateOf,
    beatTo,
    attach,
    api,
    realOf,
  }
}
