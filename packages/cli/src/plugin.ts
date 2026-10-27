import { readFileSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Plugin, ViteDevServer, WebSocketClient } from 'vite'
import { zipFab } from '@pcbjs/export/fab'
import type { RouteProgress } from '@pcbjs/compile'
import { compileEntry, compilePreview, importedFiles, type Compiled, type Preview } from './project.js'
import { previewRoute } from './preview.js'
import { referenceFiles } from './references.js'
import { boardsPayload, entriesReaching, errorOf, focusTarget, ideBoards, liveSlots, markConflicts, routeEndpoint, slotName, slotsFor, slugsOf, type BoardSlot } from './boards.js'
import { variantSlug } from '@pcbjs/core/variants'
import type { ResolvedConfig } from './config.js'
import { errorText } from './check.js'
import { ideBridge, normalizeFile } from './bridge.js'
import { connectHost, helloWarning, redactUrl, type HostClient } from './host-client.js'
import { lspHub, LSP_VERSION, type LspHub } from './lsp.js'
import { drafts, skippedRanges, type Drafts } from './drafts.js'
import { loadScope, scopeRoute, scopesInfo, type Scope, type Workspace } from './scope-state.js'
import { changedSince, scopeOf, stampFiles, withDefaults } from './scopes.js'
import { boardFindings, boardLine, routingLines, diffFindings, diffText, formatFindings, type Finding } from '@pcbjs/export/findings'
import { bootScreen, SCREEN_SCRIPT } from '@pcbjs/viewer/src/boot-screen.js'

export const VIRTUAL = 'virtual:pcbjs/board'
const RESOLVED = '\0' + VIRTUAL

export interface PluginState {
  slots: BoardSlot[]
  /** false for the client build of a prerendered site, whose pages inline the boards */
  inline?: boolean
  /** from `--ide` */
  ide?: { url: string }
  host?: HostClient | null
  /** the focused file's own preview when no board imports it, dev only */
  preview?: Preview | null
  /** the editor's unsaved buffers, compiled in place of the files */
  drafts?: Drafts | null
  /** keep Vite's report of a failed module with its stack, from `--verbose` */
  verbose?: boolean
  closing?: boolean
  idle?: () => Promise<void>
}

export interface WorkspaceExport { single: boolean; displayed: string | null; scopes: ReturnType<typeof scopesInfo>['scopes'] }


/** ms the first compile waits for a page to connect before it starts anyway; routing blocks the server, so a page must load first to follow it */
const WARM_MS = 2000

/** `pcbjs:status`: the compile the server runs, `starting` before the first; `done` of `total` entries before this one, `routed` of `legs` in the router's first pass or negotiation `round`. */
export type LoadStatus = { phase: 'starting' | 'idle' } | { phase: 'compiling' | 'routing'; entry: string; name: string | null; done: number; total: number; routed?: number; legs?: number; round?: number }
export interface FocusEvent { board: string | null; entry: string | null; boards: string[]; file: string; isolated?: boolean; scope?: string }

/** Design modules under the root, outside node_modules and .pcbjs. */
export const previewable = (root: string, abs: string): boolean =>
  abs.startsWith(root.endsWith('/') ? root : root + '/') && /\.(m?[jt]sx?)$/.test(abs) && !/\.d\.m?ts$/.test(abs) && !abs.includes('/node_modules/') && !abs.includes('/.pcbjs/')

export const pluginState = (cfg: ResolvedConfig): PluginState => ({ slots: slotsFor(cfg.entries) })

/** The default export is the first entry's first target, for the single-board client. */
export function virtualModule(state: PluginState, workspace: WorkspaceExport | null = null): string {
  const first = state.slots[0]
  const data = first?.compiled && !first.conflict ? first.compiled[0].site : null
  const p = state.inline === false ? { boards: [], single: state.slots.length === 1, errors: {}, entries: {} } : boardsPayload(state.slots, state.preview?.compiled)
  return [
    `export default ${JSON.stringify(state.inline === false ? null : data)};`,
    `export const error = ${JSON.stringify(first ? errorOf(first) : null)};`,
    `export const boards = ${JSON.stringify(p.boards)};`,
    `export const single = ${JSON.stringify(p.single)};`,
    `export const errors = ${JSON.stringify(p.errors)};`,
    `export const entries = ${JSON.stringify(p.entries)};`,
    `export const workspace = ${JSON.stringify(workspace)};`,
    '',
  ].join('\n')
}

/** With `ws`, `cfg` and `state` follow the displayed scope and `shared` keeps the server's own state. */
export function pcbjsPlugin(cfg: ResolvedConfig, clientDir: string, state: PluginState, mode: 'dev' | 'build', ws?: Workspace): Plugin {
  // the same object as `state` for one project
  const shared = state
  let server: ViteDevServer | null = null
  let timer: NodeJS.Timeout | null = null
  let running: Promise<void> | null = null
  let pending: Set<BoardSlot> = new Set()
  // none until an editor sends `initialize`
  let hub: LspHub | null = null

  const strip = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '')
  const formatError = (e: any) => {
    const msg = strip(String(e?.message ?? e))
    return e?.frame ? `${msg}\n\n${strip(String(e.frame))}` : strip(String(e?.stack ?? msg))
  }
  const ssrGraph = () => server?.environments.ssr.moduleGraph
  // also outside the project, such as a rebuilt pcbjs dist
  const inDesign = (file: string) => !!ssrGraph()?.getModulesByFile(file)?.size
  const inProject = (file: string) => file.startsWith(cfg.root) && !file.startsWith(clientDir) && !file.includes('/.pcbjs/') && !file.includes('/node_modules/')

  // every board without a file; one that failed last time is always affected
  const affected = (file: string | null): BoardSlot[] => {
    if (!file) return state.slots
    const hit = entriesReaching(ssrGraph()?.getModulesByFile(file), state.slots.map(s => s.entry.file))
    // a referenced board's file is in no module graph here
    if (!hit) return referenced(file) ? state.slots.filter(s => referencedBy(s, file) || !s.compiled || s.error || s.conflict) : state.slots
    return state.slots.filter(s => hit.has(s.entry.file) || !s.compiled || s.error || s.conflict || referencedBy(s, file))
  }
  const referencedBy = (s: BoardSlot, file: string) => !!s.compiled && referenceFiles(s.compiled).includes(file)
  const referenced = (file: string) => state.slots.some(s => referencedBy(s, file))

  const send = (event: string, data: unknown) => server!.ws.send({ type: 'custom', event, data })
  // the viewer's loading state follows `pcbjs:status`; a page opened mid-compile gets the last one inlined
  let status: LoadStatus = { phase: 'starting' }
  let sentAt = 0
  const setStatus = (st: LoadStatus) => { status = st; sentAt = performance.now(); if (server) send('pcbjs:status', st) }
  const toHost = (event: string, data: unknown) => { shared.host?.send(event, data) }

  const payload = () => ({ ...boardsPayload(state.slots, state.preview?.compiled), ...(ws?.displayed ? { scope: ws.displayed.slug } : {}) })
  const hostBoards = () => ({ ...ideBoards(state.slots), ...(ws?.displayed ? { scope: ws.displayed.slug, root: cfg.root } : {}) })
  const invalidateVirtual = () => {
    const g = server?.environments?.client?.moduleGraph
    const m = g?.getModuleById(RESOLVED)
    if (m) g!.invalidateModule(m)
  }

  const workspaceInfo = (): WorkspaceExport | null => {
    if (!ws) return null
    const i = scopesInfo(ws)
    return { single: i.single, displayed: i.displayed, scopes: i.scopes }
  }
  const announceScopes = () => {
    if (!ws || !server) return
    const i = workspaceInfo()!
    send('pcbjs:scopes', i)
    toHost('pcbjs:ide:scopes', i)
  }
  // the watcher keeps the files of every compiled scope, so an edit marks each scope whose graph holds it stale
  const trackScope = (sc: Scope) => {
    if (!server || !sc.state) return
    const files = new Set<string>([sc.configFile])
    const wanted = (f: string) => !f.includes('/node_modules/') && !f.includes('/.pcbjs/') && !f.startsWith(clientDir + '/') && !f.startsWith('\0')
    for (const sl of sc.state.slots) for (const f of importedFiles(server, sl.entry.file)) if (wanted(f)) files.add(f)
    if (sc.state.preview) for (const f of importedFiles(server, sc.state.preview.file)) if (wanted(f)) files.add(f)
    for (const f of referenceFiles(sc.state.slots.flatMap(sl => sl.compiled ?? []))) files.add(f)
    sc.files = [...files]
    sc.stamps = stampFiles(sc.files)
    sc.stale = false
    server.watcher.add(sc.files)
  }
  // under the compile lock, since loading swaps the default layers of the process
  const loadLocked = async (sc: Scope) => {
    while (running) await running
    const job = loadScope(sc, line => muted(line.replace(/^pcbjs: /, '')))
    running = job
    try { await job } finally { if (running === job) running = null }
    if (sc.status === 'ready') ws!.onLoaded?.(sc)
    else server!.config.logger.error(`[pcbjs] ${sc.slug}: ${sc.error}`, { timestamp: true })
  }
  let displaying: Promise<void> | null = null
  const display = async (sc: Scope): Promise<void> => {
    while (displaying) await displaying
    const job = (async () => {
      if (sc.status === 'unloaded') await loadLocked(sc)
      const prev = ws!.displayed
      // the stamps catch an edit whose watcher event has not arrived yet
      if (sc !== prev && sc.status === 'ready' && !sc.stale && sc.stamps.size && changedSince(sc.stamps)) sc.stale = true
      if (prev === sc && !sc.stale) return
      if (sc.status !== 'ready') { announceScopes(); return }
      // a compile of the previous scope finishes with its own config first
      while (running) await running
      ws!.displayed = sc
      cfg = sc.cfg!
      state = sc.state as PluginState
      lastFocus = null
      // the viewers learn of the switch before the new scope's board events arrive
      announceScopes()
      if (prev && prev !== sc && prev.state?.preview) prev.state.preview = null
      if (sc.files.length) server!.watcher.add(sc.files)
      muted(`showing ${sc.rel || sc.slug} at ${scopeRoute(ws!, sc)}`)
      toHost('pcbjs:ide:scope', { scope: sc.slug, root: sc.dir, route: scopeRoute(ws!, sc), url: scopeUrl(sc) })
      hub?.preview(previewPage())
      const fresh = state.slots.every(sl => !sl.compiled && !sl.error)
      if (sc.stale) {
        // the watcher did not follow its files, so the modules Vite holds for them are out of date
        const g = ssrGraph()
        for (const f of sc.files) for (const m of g?.getModulesByFile(f) ?? []) g!.invalidateModule(m)
      }
      if (sc.stale || fresh) await recompile(state.slots)
      else { send('pcbjs:boards', payload()); toHost('pcbjs:ide:boards', hostBoards()); announceScopes(); invalidateVirtual() }
    })()
    displaying = job
    try { await job } finally { if (displaying === job) displaying = null }
  }
  const scopeUrl = (sc: Scope): string | null => {
    const addr = server?.httpServer?.address()
    if (!addr || typeof addr !== 'object') return null
    const u = server!.resolvedUrls?.local?.[0] ?? `http://localhost:${addr.port}/`
    return new URL(scopeRoute(ws!, sc), u).href
  }
  const previewPage = () => {
    if (ws?.displayed) { const url = scopeUrl(ws.displayed); return url ? { url, scope: ws.displayed.slug } : null }
    const addr = server?.httpServer?.address()
    if (!addr || typeof addr !== 'object') return null
    return { url: server!.resolvedUrls?.local?.[0] ?? `http://localhost:${addr.port}/`, ...(ws ? { scope: null } : {}) }
  }
  const lspBoards = () => {
    const out: { root: string; site: import('@pcbjs/export/site-data').SiteData }[] = []
    const add = (root: string, st: { slots: BoardSlot[]; preview?: Preview | null } | null) => {
      if (!st) return
      for (const sl of liveSlots(st.slots)) for (const c of sl.compiled!) out.push({ root, site: c.site })
      if (st.preview) out.push({ root, site: st.preview.compiled.site })
    }
    if (ws) for (const sc of ws.scopes) { if (sc.cfg) add(sc.cfg.root, sc === ws.displayed ? state : sc.state) }
    else add(cfg.root, state)
    return out
  }
  const reloadScope = async (sc: Scope) => {
    const shown = ws!.displayed === sc
    sc.status = 'unloaded'
    if (!shown) { sc.stale = true; announceScopes(); return }
    ws!.displayed = null
    await display(sc)
  }
  // false when the displayed scope holds the file, so it recompiles as for one project
  const scopeChange = (file: string): boolean => {
    if (!ws) return false
    const sc = scopeOf(ws.scopes, file)
    if (sc && file === sc.configFile && sc.status !== 'unloaded') { void reloadScope(sc); return true }
    const marked: Scope[] = []
    for (const o of ws.scopes) {
      if (o === ws.displayed || o.status !== 'ready' || o.stale) continue
      // a scope never compiled has no graph yet: any file of its own directory counts
      if (o.files.includes(file) || (o === sc && !o.files.length)) { o.stale = true; marked.push(o) }
    }
    if (marked.length) { muted(`${marked.map(o => o.rel || o.slug).join(', ')} changed, ${marked.length === 1 ? 'it recompiles' : 'they recompile'} when shown`); announceScopes() }
    const d = ws.displayed
    return !(d && (sc === d || d.files.includes(file)))
  }
  const muted = (msg: string) => server!.config.logger.info(`[pcbjs] ${msg}`, { timestamp: true })

  // /__pcbjs/cli/: inspect and shot reuse this server's compile, see dev-reuse.ts
  const slotOf = async (file: string): Promise<{ slot: BoardSlot; scope: Scope | null; root: string } | null> => {
    for (let i = 0; i < 6000 && (timer || running || displaying); i++) await (running ?? displaying ?? new Promise(r => setTimeout(r, 25)))
    const real = (f: string) => { try { return realpathSync(f) } catch { return f } }
    if (!ws) { const slot = state.slots.find(s => real(s.entry.file) === file); return slot ? { slot, scope: null, root: cfg.root } : null }
    for (const sc of ws.scopes) {
      const st = sc === ws.displayed ? state : sc.state
      const slot = st?.slots.find(s => real(s.entry.file) === file)
      if (slot && sc.cfg) return { slot, scope: sc, root: sc.cfg.root }
    }
    return null
  }
  const notCurrent = (slot: BoardSlot, sc: Scope | null): string | null => {
    if (!slot.compiled) return slot.error ? 'its last compile failed' : 'not compiled yet'
    if (slot.error) return 'its last compile failed'
    if (slot.conflict) return slot.conflict
    if (sc?.stale || (sc && sc.status !== 'ready')) return 'its scope changed since'
    if (!slot.stamps || changedSince(slot.stamps)) return 'a file changed since its compile'
    return null
  }
  const cliEndpoint = async (what: string, q: URLSearchParams, res: import('node:http').ServerResponse) => {
    const reply = (body: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
    const found = await slotOf(q.get('entry') ?? '')
    if (!found) return reply({ current: false, reason: 'no such entry on this server' })
    const { slot, scope, root } = found
    const why = notCurrent(slot, scope)
    if (why) return reply({ current: false, reason: why })
    const c0 = slot.compiled![0]
    const head = { current: true, ms: Math.round(c0.ms), age: Date.now() - (slot.doneAt ?? Date.now()) }
    if (what === 'board') {
      return reply({ ...head, name: c0.board.name, targets: slot.compiled!.map(c => c.board.variant?.name ?? null), refs: c0.board.footprints.map(f => f.ref),
        route: ws && scope ? scopeRoute(ws, scope) : '/', displayed: !ws || ws.displayed === scope })
    }
    if (what === 'inspect') {
      const { inspectMany, pickTarget } = await import('./inspect.js')
      const c = pickTarget(slot.compiled!, q.get('target') ?? undefined)
      if (typeof c === 'string') return reply({ ...head, error: c })
      let requests: { query?: string; lengths?: boolean; layer?: string }[] = []
      try { requests = JSON.parse(q.get('requests') ?? '[]') } catch { /* none: every footprint */ }
      const rel = c.entry.file.startsWith(root + '/') ? c.entry.file.slice(root.length + 1) : c.entry.rel
      return reply({ ...head, results: inspectMany(c.board, rel, root, requests) })
    }
    res.statusCode = 404
    res.end('no such cli endpoint')
  }

  const sessionsOn = new Set<WebSocketClient['socket']>()

  // by socket, with the board each one last reported in pcbjs:viewer:hello and pcbjs:viewer:board
  const viewers = new Map<WebSocketClient['socket'], { client: WebSocketClient; board: string | null }>()
  let lastFocus: { abs: string; rel: string; isolated: boolean } | null = null
  const focusEvent = (f: NonNullable<typeof lastFocus>, current: string | null): FocusEvent | null => {
    if (f.isolated) {
      const pv = state.preview
      if (!pv || pv.file !== f.abs) return null
      const name = pv.compiled.board.name
      return { board: name, entry: null, boards: [name], file: f.rel, isolated: true, ...(ws?.displayed ? { scope: ws.displayed.slug } : {}) }
    }
    return { ...focusTarget(ssrGraph(), state.slots, f.abs, current), file: f.rel, ...(ws?.displayed ? { scope: ws.displayed.slug } : {}) }
  }
  // a viewer that never said hello gets the focus as for no board
  const sendFocus = () => {
    if (!lastFocus) return
    const generic = focusEvent(lastFocus, null)
    for (const client of server!.ws.clients) {
      const v = viewers.get(client.socket)
      const e = v ? focusEvent(lastFocus, v.board) : generic
      if (e) client.send({ type: 'custom', event: 'pcbjs:focus', data: e })
    }
  }
  const dropPreview = (why: string) => {
    if (!state.preview) return
    muted(`preview of ${state.preview.rel} closed (${why})`)
    state.preview = null
    send('pcbjs:boards', payload())
    hub?.refresh()
  }
  const loadPreview = async (abs: string, rel: string): Promise<Preview | null> => {
    while (running) await running
    let out: Preview | null = null
    const job = (async () => {
      try {
        out = await scoped(() => compilePreview(server!, cfg, abs, rel))
        if (out) markDraft([out.compiled], abs)
        if (!out) muted(`no preview for ${rel}: its default export is not a <PCB>, a part, a circuit instance or a layout`)
      } catch (e: any) {
        muted(`no preview for ${rel}: ${strip(String(e?.message ?? e)).split('\n')[0]}`)
      }
    })()
    running = job
    try { await job } finally { if (running === job) running = null }
    return out
  }
  // the board whose tree holds the file, else the isolated preview of its default export, else nothing
  let focusSeq = 0
  const focus = async (file: string) => {
    const seq = ++focusSeq
    if (ws) {
      // the scopes are real paths, as Vite names files; an editor may name the file through a symbolic link
      let real = normalizeFile(cfg.root, file).abs
      try { real = realpathSync(real) } catch { /* a file not saved yet */ }
      const sc = scopeOf(ws.scopes, real)
      if (!sc) return
      if (sc !== ws.displayed) await display(sc)
      if (seq !== focusSeq || ws.displayed !== sc) return
      file = real
    }
    const { abs, rel } = normalizeFile(cfg.root, file)
    await compiledOnce()
    if (seq !== focusSeq) return
    if (focusTarget(ssrGraph(), state.slots, abs).entry) {
      lastFocus = { abs, rel, isolated: false }
      sendFocus()
      if (state.preview) dropPreview('focus moved to a board')
      return
    }
    if (!previewable(cfg.root, abs)) return
    if (state.preview?.file !== abs) {
      const pv = await loadPreview(abs, rel)
      if (seq !== focusSeq || !pv) return
      state.preview = pv
      muted(`preview of ${rel}: ${pv.kind}, ${pv.compiled.board.stats.footprints} footprints`)
      send('pcbjs:boards', payload())
      hub?.refresh()
    }
    lastFocus = { abs, rel, isolated: true }
    sendFocus()
  }
  const closeFile = (file: string) => {
    const { abs } = normalizeFile(cfg.root, file)
    if (state.preview?.file === abs) dropPreview('file closed')
  }
  // keeps its last good board when the compile fails
  const refreshPreview = async () => {
    const pv = state.preview
    if (!pv) return
    const next = await loadPreview(pv.file, pv.rel)
    if (!next || state.preview !== pv) return
    state.preview = next
    send('pcbjs:boards', payload())
    hub?.refresh()
  }

  // by board and target, for the one-line diff of the dev log
  const ownFindings = new Map<string, Finding[]>()
  const findingsOf = () => ws?.displayed?.findings ?? ownFindings
  const scoped = <T>(fn: () => Promise<T>): Promise<T> => (ws?.displayed ? withDefaults(ws.displayed, fn) : fn())
  const draftFiles = (file: string) => {
    const d = shared.drafts
    if (!d?.files().length || !server) return []
    const graph = importedFiles(server, file)
    return d.files().filter(f => graph.has(f))
  }
  const markDraft = (cs: Compiled[], file: string) => {
    const files = draftFiles(file)
    const skipped = files.reduce((n, f) => n + (shared.drafts?.get(f)?.skipped.length ?? 0), 0)
    for (const c of cs) { if (files.length) c.site.draft = { skipped }; else delete c.site.draft }
  }
  const compileSlots = async (slots: BoardSlot[]) => {
    const done: BoardSlot[] = []
    const lastFindings = findingsOf()
    for (const [i, s] of slots.entries()) {
      if (shared.closing) break
      const at = { entry: s.entry.rel, name: s.compiled && !s.conflict ? slotName(s) : null, done: i, total: slots.length }
      setStatus({ phase: 'compiling', ...at })
      // the router runs synchronously: each send is written out at once, a tenth of a second apart at most
      const progress = ({ done, legs, round }: RouteProgress) => { if (legs && (done === legs || performance.now() - sentAt > 100)) setStatus({ phase: 'routing', ...at, routed: done, legs, ...(round ? { round } : {}) }) }
      try {
        const draft = draftFiles(s.entry.file).length > 0
        s.compiled = await scoped(() => compileEntry(server!, cfg, s.entry, true, draft, progress))
        markDraft(s.compiled, s.entry.file)
        s.error = null
        s.stamps = stampFiles([...importedFiles(server!, s.entry.file)].filter(f => !f.includes('/node_modules/') && !f.startsWith('\0')).concat(referenceFiles(s.compiled)))
        // referenced boards compile in their own process, so the watcher follows their files here
        if (referenceFiles(s.compiled).length) server!.watcher.add(referenceFiles(s.compiled))
        s.doneAt = Date.now()
        done.push(s)
      } catch (e: any) {
        s.error = formatError(e)
        const name = s.compiled && !s.conflict ? slotName(s) : null
        const msg = strip(String(e?.message ?? e))
        if (s.compiled) for (const c of s.compiled) { c.site.stale = true; c.site.staleError = msg }
        const t = errorText(e, shared.verbose, cfg.root)
        server!.config.logger.error(`[pcbjs] ${name ?? s.entry.rel}: ${t.line}${t.detail.map(l => `\n  ${l}`).join('')}${name ? '\n  the viewer keeps the last good board, marked stale' : ''}`, { timestamp: true })
        send('pcbjs:error', { name, entry: s.entry.rel, message: strip(String(e?.message ?? e)), stack: strip(String(e?.stack ?? '')), text: s.error })
      }
    }
    markConflicts(state.slots)
    for (const s of done) {
      if (s.conflict) {
        server!.config.logger.error(`[pcbjs] ${s.entry.rel}: ${s.conflict}`, { timestamp: true })
        send('pcbjs:error', { name: null, entry: s.entry.rel, message: s.conflict, stack: '', text: s.conflict })
        continue
      }
      const lines: string[] = []
      const targets: { target?: string; findings: Finding[] }[] = []
      let added = 0, fixed = 0, unchanged = 0, seen = false
      for (const c of s.compiled!) {
        const b = c.board
        lines.push(boardLine(b, c.entry.rel, c.ms))
        const f = boardFindings(b, cfg.root)
        targets.push({ target: b.variant?.name, findings: f })
        const key = `${b.name}|${b.variant?.name ?? ''}`
        const prev = lastFindings.get(key)
        if (prev) { seen = true; const d = diffFindings(prev, f); added += d.added.length; fixed += d.fixed.length; unchanged += d.unchanged }
        lastFindings.set(key, f)
      }
      lines.push(...routingLines(s.compiled!.map(c => c.board)))
      lines.push(...formatFindings(targets, { cap: 5, more: `all in pcbjs check ${s.entry.rel}` }))
      if (seen) lines.push(`  since the last compile: ${diffText(added, fixed, unchanged)}`)
      server!.config.logger.info(`[pcbjs] ${lines.join('\n')}`, { timestamp: true })
      for (const c of s.compiled!) send('pcbjs:board', c.site)
    }
    setStatus({ phase: 'idle' })
    send('pcbjs:boards', payload())
    toHost('pcbjs:ide:boards', hostBoards())
    if (ws?.displayed) { trackScope(ws.displayed); announceScopes() }
    invalidateVirtual()
    hub?.refresh()
  }

  const recompile = async (slots: BoardSlot[] = state.slots) => {
    if (!server || shared.closing) return
    while (running) await running
    running = compileSlots(slots)
    try { await running } finally { running = null }
  }
  const compiledOnce = async () => {
    while (running) await running
    const todo = state.slots.filter(s => !s.compiled && !s.error)
    if (todo.length) await recompile(todo)
  }
  let previewDirty = false
  const schedule = (file: string | null) => {
    for (const s of affected(file)) pending.add(s)
    const pv = state.preview
    if (pv && (!file || file === pv.file || entriesReaching(ssrGraph()?.getModulesByFile(file), [pv.file])?.size)) previewDirty = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const slots = state.slots.filter(s => pending.has(s))
      pending = new Set()
      const again = previewDirty
      previewDirty = false
      void recompile(slots).then(() => (again ? refreshPreview() : undefined))
    }, 60)
  }

  const connectIde = (s: ViteDevServer, url: string, cursor: (file: string, line: unknown, col: unknown) => void) => {
    const logger = s.config.logger
    const where = redactUrl(url)
    for (const level of ['info', 'warn', 'error'] as const) {
      const write = logger[level].bind(logger)
      logger[level] = (msg, o) => {
        write(msg, o)
        if (msg.includes('[pcbjs]')) toHost('pcbjs:ide:log', { level, text: strip(msg).trim() })
      }
    }
    shared.host = connectHost({
      url,
      onHello: h => {
        logger.info(`[pcbjs] ide host connected: ${h.name} ${h.version}`.trimEnd(), { timestamp: true })
        const w = helloWarning(h)
        if (w) logger.warn(w, { timestamp: true })
      },
      onCursor: c => cursor(c.file, c.line, c.col),
      onFocus: f => { void focus(f.file) },
      onClose: f => closeFile(f.file),
      onRpc: msg => hub?.message('host', msg, m => shared.host?.sendRpc(m) ?? false),
      onStatus: (st, detail) => {
        // the host starts a new language client after a reconnect
        if (st === 'connected' || st === 'disconnected') hub?.drop('host')
        if (st === 'unreachable') logger.warn(`[pcbjs] ide host ${where} unreachable${detail ? ` (${detail})` : ''}, retrying`, { timestamp: true })
        else if (st === 'disconnected') logger.info(`[pcbjs] ide host ${where} disconnected, reconnecting`, { timestamp: true })
      },
    })
    s.httpServer?.once('close', () => { shared.host?.close(); shared.host = null })
  }

  return {
    name: 'pcbjs',
    resolveId(id) { if (id === VIRTUAL) return RESOLVED },
    async load(id) {
      if (id !== RESOLVED) return
      if (mode === 'dev' && server && ws?.scopes.length === 1 && !ws.displayed) await display(ws.scopes[0])
      if (mode === 'dev' && server) await compiledOnce()
      return virtualModule(state, workspaceInfo())
    },
    configureServer(s) {
      // the build compiles through its own throwaway server
      if (mode !== 'dev') return
      server = s
      shared.idle = async () => { while (running) await running }
      // pcbjs prints the one line of a failed SSR module itself, the stack with --verbose
      {
        const logger = s.config.logger, error = logger.error.bind(logger)
        logger.error = (msg, o) => { if (!strip(msg).includes('Error when evaluating SSR module')) error(msg, o) }
      }
      s.watcher.on('add', f => { if (scopeChange(f)) return; if (inProject(f)) schedule(null) })
      s.watcher.on('unlink', f => {
        if (scopeChange(f)) return
        if (state.preview?.file === f) dropPreview('file deleted')
        if (inProject(f)) schedule(null)
      })
      hub = lspHub({
        version: LSP_VERSION,
        boards: lspBoards,
        preview: previewPage,
        focus: f => { void focus(f) },
        cursor: (f, line, col, target) => bridge.cursor(f, line, col, target),
        close: closeFile,
        draft: (f, text) => { let r = f; try { r = realpathSync(f) } catch { /* not saved yet */ } shared.drafts?.set(r, text, f) },
        skipped: () => skippedRanges(shared.drafts),
        log: muted,
      })
      s.httpServer?.once('close', () => { hub?.dispose(); hub = null })
      // the save itself drops the draft
      shared.drafts = drafts(f => {
        const g = ssrGraph()
        for (const m of g?.getModulesByFile(f) ?? []) g!.invalidateModule(m)
        if (!scopeChange(f) && (inProject(f) || inDesign(f))) schedule(f)
      })
      s.httpServer?.once('close', () => { shared.drafts?.dispose(); shared.drafts = null })
      // ahead of the board endpoints since it never waits for a compile
      const bridge = ideBridge(s, () => cfg.root, { host: () => shared.host ?? null, onFocus: f => { void focus(f) }, onClose: closeFile, lsp: hub })
      s.middlewares.use(bridge.middleware)
      s.ws.on('pcbjs:lsp', (data: unknown, client: WebSocketClient) => {
        const known = sessionsOn.has(client.socket)
        if (!known) { sessionsOn.add(client.socket); client.socket.once('close', () => { sessionsOn.delete(client.socket); hub?.drop(client.socket) }) }
        hub?.message(client.socket, data, m => { client.send({ type: 'custom', event: 'pcbjs:lsp', data: m }); return true })
      })
      // a viewer reports its board so a focus can keep it there
      const boardOf = (data: any): string | null => (typeof data?.board === 'string' ? data.board : typeof data?.name === 'string' ? data.name : null)
      s.ws.on('pcbjs:viewer:hello', (data: any, client) => {
        if (!viewers.has(client.socket)) client.socket.once('close', () => viewers.delete(client.socket))
        viewers.set(client.socket, { client, board: boardOf(data) })
        // the page's virtual module may predate the last compile or the isolated preview
        if (state.slots.some(sl => sl.compiled || sl.error)) client.send({ type: 'custom', event: 'pcbjs:boards', data: payload() })
        const e = lastFocus ? focusEvent(lastFocus, boardOf(data)) : null
        if (e) client.send({ type: 'custom', event: 'pcbjs:focus', data: e })
        const c = bridge.lastCursor()
        if (c) client.send({ type: 'custom', event: 'pcbjs:cursor', data: c })
      })
      // hover and focus relayed between the viewers of one board; the last focus of each board waits for a viewer that comes later
      const syncBoard = new Map<WebSocketClient['socket'], string | null>()
      const syncId = new Map<WebSocketClient['socket'], number>()
      let syncSeq = 0
      const syncFocus = new Map<string, unknown>()
      const idOf = (c: WebSocketClient) => { let n = syncId.get(c.socket); if (n === undefined) { syncId.set(c.socket, n = ++syncSeq); c.socket.once('close', () => { relay('pcbjs:sync:hover', { board: syncBoard.get(c.socket), hover: null }, c); syncBoard.delete(c.socket); syncId.delete(c.socket) }) } return n }
      const relay = (event: string, data: any, from: WebSocketClient) => {
        const board = typeof data?.board === 'string' ? data.board : null
        if (!board) return
        const out = { ...data, from: idOf(from) }
        for (const c of s.ws.clients) if (c.socket !== from.socket && (syncBoard.get(c.socket) ?? board) === board) c.send({ type: 'custom', event, data: out })
      }
      s.ws.on('pcbjs:sync:hello', (data: any, client) => {
        const board = typeof data?.board === 'string' ? data.board : null
        idOf(client)
        syncBoard.set(client.socket, board)
        const f = board && data?.focus !== false ? syncFocus.get(board) : undefined
        if (f) client.send({ type: 'custom', event: 'pcbjs:sync:focus', data: f })
      })
      s.ws.on('pcbjs:sync:hover', (data: any, client) => relay('pcbjs:sync:hover', data, client))
      s.ws.on('pcbjs:sync:focus', (data: any, client) => {
        if (typeof data?.board !== 'string' || !data.focus) return
        syncFocus.set(data.board, { ...data, from: idOf(client) })
        relay('pcbjs:sync:focus', data, client)
      })
      s.ws.on('pcbjs:viewer:status', (_data: unknown, client) => {
        client.send({ type: 'custom', event: 'pcbjs:status', data: status })
        clearTimeout(warm)
        void compiledOnce()
      })
      s.ws.on('pcbjs:viewer:board', (data: any, client) => {
        const v = viewers.get(client.socket)
        if (v) v.board = boardOf(data)
        else { client.socket.once('close', () => viewers.delete(client.socket)); viewers.set(client.socket, { client, board: boardOf(data) }) }
      })
      if (shared.ide) connectIde(s, shared.ide.url, bridge.cursor)
      s.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith('/__pcbjs/')) return next()
        if (url.startsWith('/__pcbjs/cli/')) { await cliEndpoint(url.slice('/__pcbjs/cli/'.length), new URL(req.url ?? '', 'http://x').searchParams, res); return }
        if (ws && url === '/__pcbjs/scopes') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(workspaceInfo())); return }
        const sm = ws ? /^\/__pcbjs\/scope\/([^/]+)\/?$/.exec(url) : null
        if (sm) {
          const sc = ws!.scopes.find(x => x.slug === decodeURIComponent(sm[1]))
          if (!sc) { res.statusCode = 404; res.end('no such scope'); return }
          await display(sc)
          if (ws!.displayed === sc) await compiledOnce()
          const body = ws!.displayed === sc ? payload() : { boards: [], single: true, errors: { [sc.configFile.slice(sc.dir.length + 1)]: sc.error ?? 'not loaded' }, entries: {}, scope: sc.slug }
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ...body, workspace: workspaceInfo() }))
          return
        }
        const pr = previewRoute(url.slice('/__pcbjs/'.length))
        if (pr) {
          const c = state.preview?.rel === pr.rel ? state.preview.compiled : null
          if (!c) { res.statusCode = 404; res.end('no preview'); return }
          if (pr.file === 'board.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(c.site)); return }
          if (pr.file.endsWith('.pcb.svg')) { res.setHeader('content-type', 'image/svg+xml'); res.end(c.svg); return }
          if (pr.file === `fab/${c.fab.zipName}`) { res.setHeader('content-type', 'application/zip'); res.end(Buffer.from(zipFab(c.fab))); return }
          if (pr.file.startsWith('fab/') && c.fab.files[pr.file.slice(4)] !== undefined) { res.setHeader('content-type', 'text/plain; charset=utf-8'); res.end(c.fab.files[pr.file.slice(4)]); return }
          res.statusCode = 404; res.end('not found'); return
        }
        await compiledOnce()
        const live = liveSlots(state.slots)
        const route = routeEndpoint(url.slice('/__pcbjs/'.length), live.map(slotName), slugsOf(state.slots))
        if (!route) { res.statusCode = 500; res.end(state.slots.map(errorOf).filter(Boolean).join('\n\n') || 'not compiled'); return }
        const targets = live.find(l => slotName(l) === route.name)!.compiled!
        const c = targets.find(t => !route.variant || (t.board.variant && variantSlug(t.board.variant.name) === route.variant)) ?? targets[0]
        const file = route.file
        if (file === 'board.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(c.site)); return }
        if (file === `${c.board.name}.pcb.svg`) { res.setHeader('content-type', 'image/svg+xml'); res.end(c.svg); return }
        if (file === `fab/${c.fab.zipName}`) {
          res.setHeader('content-type', 'application/zip'); res.setHeader('content-disposition', `attachment; filename="${c.fab.zipName}"`)
          res.end(Buffer.from(zipFab(c.fab))); return
        }
        if (file.startsWith('fab/') && c.fab.files[file.slice(4)] !== undefined) { res.setHeader('content-type', 'text/plain; charset=utf-8'); res.end(c.fab.files[file.slice(4)]); return }
        res.statusCode = 404; res.end('not found')
      })
      const warm = setTimeout(() => void compiledOnce(), WARM_MS)
      s.httpServer?.once('close', () => clearTimeout(warm))
    },
    // the loading screen's first paint, see boot-screen.js, and what it names before the first board: the project, and how to start the server again
    transformIndexHtml(html) {
      if (mode !== 'dev') return
      const project = basename(ws && !ws.displayed ? ws.folders[0] : cfg.root)
      const boot = { project, root: cfg.root, devJson: join(cfg.root, '.pcbjs', 'dev.json'), command: ws ? `pcbjs dev --workspace ${ws.folders.join(' ')}` : 'pcbjs dev', status }
      const name = (status.phase === 'compiling' || status.phase === 'routing' ? status.name : null) ?? project
      const text = status.phase === 'starting' ? 'starting the dev server' : 'loading the viewer'
      const screen = bootScreen({ mark: readFileSync(join(clientDir, 'src', 'mark.svg'), 'utf8'), name, text, busy: true })
      return {
        html: html.replace('<body>', `<body><div id="pcbjs-boot" class="boot">${screen}</div>`),
        tags: [
          { tag: 'style', children: readFileSync(join(clientDir, 'src', 'boot.css'), 'utf8'), injectTo: 'head' },
          { tag: 'script', children: `window.__PCBJS_BOOT__ = ${JSON.stringify(boot).replace(/</g, '\\u003c')}\n${SCREEN_SCRIPT}`, injectTo: 'head' },
        ],
      }
    },
    // the ssr environment has no client to reload: recompile() reloads the design
    hotUpdate(opts) {
      if (mode === 'dev' && this.environment.name === 'ssr' && (inProject(opts.file) || inDesign(opts.file) || referenced(opts.file) || (ws && (scopeOf(ws.scopes, opts.file) || ws.scopes.some(o => o.files.includes(opts.file)))))) { if (!scopeChange(opts.file)) schedule(opts.file); return [] }
    },
    handleHotUpdate(ctx) {
      if (mode !== 'dev') return
      if (ws && scopeOf(ws.scopes, ctx.file) && !ctx.file.startsWith(clientDir)) { if (!scopeChange(ctx.file)) schedule(ctx.file); return [] }
      if (ws && !ctx.file.startsWith(clientDir) && (inDesign(ctx.file) || ws.scopes.some(o => o.files.includes(ctx.file)))) { if (!scopeChange(ctx.file)) schedule(ctx.file); return ctx.modules.length ? undefined : [] }
      if (inProject(ctx.file) || referenced(ctx.file)) { schedule(ctx.file); return [] } // the client is updated through the pcbjs events, never reloaded
      if (inDesign(ctx.file)) { schedule(ctx.file); return ctx.modules.length ? undefined : [] }
    },
  }
}
