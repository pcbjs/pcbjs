// The page around the boards: its route, theme, workspace, IDE and embed modes, agents, toasts and the command bus, with one BoardStore
// and one pane per board. One per render; nothing here touches a browser global during setup, so the server and the client render alike.
import { computed, effectScope, inject, markRaw, nextTick, reactive, shallowRef, watch, watchEffect, type InjectionKey } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'
import type { FacetSet } from '@pcbjs/core/site-facets'
import type { View } from '@pcbjs/core/internal/plugin'
import type { AgentInfo, BoardsMsg, FacetMsg, FocusEvent, Invalidate, LoadStatus, Run, ScopeSummary, ScopesMsg, SendRequest } from '@pcbjs/core/protocol'
import { createBoard, editNote, editSession, facetKey, type BoardStore } from './board-store'
import type { LiveBoard } from './live'
import { createPane, focusAt, leavePane, mountedViews, paneEffects, VIEW_FACETS, type Mode, type PaneState } from './pane'
import { load, save, type PaneContext, type Theme, type ViewPrefs } from './context'
import { commandBus } from './keys'
import { undoStep, undoKey, undoProject } from './undo'
import { fromWire } from './refs'
import { markAt } from './finding-marks'
import { schFindingAt } from './schview'
import { selectRefs } from './selection'
import { openTarget } from './open'
import { focusSwitch, ideRoute, pageUrl, parseIdeQuery, type IdeRequest, type IdeTheme } from './ide'
import { EXPLODE_MAX, hasViewQuery, queryMode, soloHidden, type ViewQuery } from './query'
import { appBase, assetUrl, boardPath, checkSummary, drcSummary, groupBoards, pickTarget, routeFromPath, targetBySlug, targetName, variantSlug, type BoardGroup } from './variants'
import { env } from './env'
export { checkSummary, drcSummary }
export type { FocusEvent, IdeTheme }

// nothing at the top level may need a DOM, so the app can be rendered without one; every browser global is behind this
const browser = typeof window !== 'undefined' && typeof document !== 'undefined'
const slash = (b: string) => (b.endsWith('/') ? b : b + '/')

/** The data a page starts from: what the virtual module, the inlined `window.__PCBJS_DATA__` or the prerenderer hands over, each board target as its facets. */
export interface SiteState {
  boards?: FacetSet[]
  single?: boolean
  /** the last compile error of each entry, keyed by entry path, in entry order */
  errors?: Record<string, string | null>
  /** the entry each board came from, keyed by board name */
  entries?: Record<string, string>
  /** dev: the run of the session's snapshot the boards are from */
  run?: number | null
}
/** The scope a path names on a workspace dev server with several scopes: its first segment when that is a scope slug. */
export function scopeOfPath(path: string, slugs: readonly string[]): string | null {
  const m = /^\/([^/?#]+)/.exec(path)
  if (!m) return null
  let seg: string
  try {
    seg = decodeURIComponent(m[1])
  } catch {
    return null
  }
  return slugs.includes(seg) ? seg : null
}
export interface StoreInit extends SiteState {
  /** a workspace dev server's scopes, from the virtual module */
  workspace?: ScopesMsg | null
  /** the scope this page shows, by slug; null on the workspace's own home page */
  scope?: string | null
  /** the path of the page, `location.pathname` in the browser */
  path?: string
  /** the base URL the site was built with, BASE_URL by default */
  baseUrl?: string
  /** start in the compact IDE mode, as `?ide=1` does in the browser */
  ide?: boolean
  /** the editor's theme kind in IDE mode, as `?theme=` gives it */
  ideTheme?: IdeTheme | null
  /** the query of the page in IDE mode, kept on every URL the viewer writes */
  ideSearch?: string
  /** start in embed mode, as `?embed=1` does in the browser */
  embed?: boolean
  /** the query of the page in embed mode, kept on every URL the viewer writes */
  embedSearch?: string
}

export type Route = { page: 'home' } | { page: 'board'; name: string | null; target: string | null }
/** One card per entry in entry order, with the board it last compiled to, the board's targets in order, and its error. */
export interface Card {
  entry: string
  board: SiteData | null
  targets: SiteData[]
  error: string | null
}

/** A fresh page. Every watcher it makes belongs to it and stops with `stop()`. */
export function createViewer(init: StoreInit = {}) {
  const scope = effectScope(true)
  /** Run `fn` in the page's scope, so the watchers it makes stop with the page. */
  const run = <T>(fn: () => T): T => scope.run(fn)!
  const shell = run(() => makeShell(init, run))
  return Object.assign(shell, {
    run,
    stop: () => {
      for (const b of shell.boards.values()) b.stop()
      scope.stop()
    },
  })
}
export type Shell = ReturnType<typeof createViewer>

/** The key the app provides its page under; a global symbol so a hot reload of this file still finds the page App.vue was given. */
export const STORE = Symbol.for('pcbjs:store') as InjectionKey<Shell>
export function useShell(): Shell {
  const s = inject(STORE, null)
  if (!s) throw new Error('pcbjs: no page provided, call app.provide(STORE, createViewer(...))')
  return s
}

function makeShell(init: StoreInit, run: <T>(fn: () => T) => T) {
  // `/` in dev; a site built with a relative base finds it from the page's path
  const base = appBase(init.baseUrl ?? env.base, init.path ?? '/')
  const homeHref = base
  const boardHref = (name: string, target?: string | null) => boardPath(base, name, target)
  // relative URLs resolve under the base so they work from every route
  const asset = (url: string) => assetUrl(url, base)

  const state = reactive({
    /** the boards by name in entry order */
    order: [] as string[],
    single: init.single ?? true,
    /** the last compile error of each entry, keyed by entry path, in entry order */
    errors: { ...(init.errors ?? {}) } as Record<string, string | null>,
    /** the entry each board came from, keyed by board name */
    entries: { ...(init.entries ?? {}) } as Record<string, string>,
    /** the path of the page, kept in sync with the history */
    path: init.path ?? base,
    /** true while a built site without inlined data fetches its boards */
    loading: false,
    updatedAt: 0,
  })

  // IDE mode: the compact viewer an editor embeds, following the editor's focus
  const ide = reactive({
    on: !!init.ide,
    /** the editor's theme kind, null to follow the stored or system theme */
    theme: (init.ideTheme ?? null) as IdeTheme | null,
    /** the query the page was opened with, kept on every URL the viewer writes */
    search: init.ideSearch ?? '',
    /** false when the editor shows findings, nets and BOM itself, from `?panel=0` */
    panel: parseIdeQuery(init.ideSearch ?? '').panel,
    /** the one view of an editor pane, from `?view=`; null lets the viewer switch */
    view: parseIdeQuery(init.ideSearch ?? '').view as Mode | null,
    /** the board the editor last focused, shown for the home path */
    focused: null as string | null,
    /** counts board switches by focus, for the flash of the board name */
    flash: 0,
  })

  // embed mode: the bare view a page puts in an iframe, driven by postMessage, see docs/viewer.md "Embedding"
  const embed = reactive({
    on: !!init.embed,
    /** the query the page was opened with, kept on every URL the viewer writes */
    search: init.embedSearch ?? '',
    /** false hides the view's own toolbars, from `?tools=0` */
    tools: parseIdeQuery(init.embedSearch ?? '').tools,
    /** the part the embedding page last asked for, so the selection it causes is not posted back; undefined for none */
    asked: { ref: undefined as string | null | undefined },
  })

  // a workspace dev server: its scopes and the one this page shows
  const workspace = reactive({ info: (init.workspace ?? null) as ScopesMsg | null, scope: (init.scope ?? null) as string | null })
  const workspaceHome = computed(() => !!workspace.info && !workspace.info.single && workspace.scope == null)
  const scopeCards = computed<ScopeSummary[]>(() => workspace.info?.scopes ?? [])
  /** True when the dev server follows another scope than this page's, whose board events are then not for it. */
  const otherScope = (scope?: string | null) => workspace.scope != null && (scope ?? workspace.info?.displayed ?? workspace.scope) !== workspace.scope

  // the editing tools of this page's connection, shared by its boards
  const edit = editSession()
  // plain maps of reactive entries, so asking for a new board inside a computed triggers nothing
  const boards = new Map<string, BoardStore>()
  const panes = new Map<string, PaneState>()
  const contexts = new Map<string, PaneContext>()
  /** The store of a board, made on first use. */
  function board(name: string): BoardStore {
    const had = boards.get(name)
    if (had) return had
    const b = createBoard(name, edit)
    boards.set(name, b)
    b.run = live.run
    return b
  }
  /** Take a board made elsewhere, such as one `useBoard` shares, as one of this page's. */
  function adopt(b: BoardStore): void {
    boards.set(b.name, b)
    if (!state.order.includes(b.name)) state.order.push(b.name)
  }
  /** The pane a board shows in on this page, made on first use; an editor pane opened on one view keeps it. */
  function pane(name: string): PaneState {
    let p = panes.get(name)
    if (!p) {
      panes.set(name, (p = createPane(defaultMode(), ide.on ? ide.view : null)))
      const b = board(name),
        made = p
      run(() => paneEffects(b, made))
    }
    return p
  }
  /** What the views and panels of a board on this page draw from. */
  function context(name: string): PaneContext {
    let c = contexts.get(name)
    if (!c)
      contexts.set(
        name,
        (c = markRaw({
          board: board(name),
          pane: pane(name),
          prefs,
          commands,
          shell: shell as Shell,
          theme: resolvedTheme,
          toggle: (k: 'grid' | 'ratsnest') => (k === 'grid' ? toggleGrid() : toggleRatsnest()),
          say: showToast,
          open: async (t, quiet) => {
            const s = board(name).site
            if (s) await openTarget(s, t, showToast, quiet)
          },
        } satisfies PaneContext)),
      )
    return c
  }
  /** The view a board starts in: 3D while editing, in the dev server, in IDE mode and embedded, 2D in a built site. */
  function defaultMode(): '2d' | '3d' {
    return ide.on || embed.on || env.dev || groups.value.some(g => g.targets.some(t => t.dev)) ? '3d' : '2d'
  }

  // dev: the session's run, the status stream, the draft holding the compile and the out-of-sync notice
  const live = reactive({
    run: (init.run ?? null) as Run | null,
    status: null as LoadStatus | null,
    /** the draft holding the compile, from the heartbeat */
    hold: null as { file: string; line: number } | null,
    notice: null as { repeated: boolean; url: string | null; file: string | null; n: number } | null,
    /** the last facet taken, without its data */
    last: null as { board: string; target: string | null; facet: string; run: number; stage: string } | null,
  })

  /** The handler of `pcbjs:facet`: one facet of a board target, taken unless older than the one held; the board shows from its first `meta`. */
  function take(m: FacetMsg): ReturnType<BoardStore['take']> {
    if (otherScope()) return { site: null }
    const b = board(m.board)
    const r = b.take(m)
    if (!r.dropped && !r.bad) live.last = { board: m.board, target: m.target ?? null, facet: m.facet, run: m.run, stage: m.stage }
    if (r.site) {
      if (!state.order.includes(m.board)) state.order.push(m.board)
      const entry = state.entries[m.board]
      if (entry) state.errors[entry] = null
      state.updatedAt = Date.now()
    }
    return r
  }
  /** Every board's held facets in one map by board key, as the heartbeat compares them. */
  function held(): Map<string, LiveBoard> {
    return new Map([...boards.values()].flatMap(b => [...b.held]))
  }
  /** The handler of `pcbjs:invalidate`. */
  function invalidate(m: Invalidate) {
    if (!otherScope()) board(m.board).invalidate(m)
  }
  /** The handler of `pcbjs:status`; a compile that ended resolved every edit before it. */
  function status(st: LoadStatus) {
    live.status = st
    if (st.phase === 'idle') for (const b of boards.values()) b.settle()
  }
  /** Every board target as its facets came whole at `run`, from the page's data or `pcbjs:boards`; a target held of a newer run stays. */
  function takeSets(sets: readonly FacetSet[], run: Run | null) {
    const names = [...new Set(sets.map(s => s.board))]
    for (const name of names)
      board(name).takeSets(
        sets.filter(s => s.board === name),
        run,
      )
    // a board only facets have drawn so far stays while it holds a newer run than these
    for (const name of state.order) {
      if (names.includes(name)) continue
      const b = boards.get(name)
      b?.takeSets([], run)
      if (b?.targets.length) names.push(name)
    }
    for (const b of boards.values()) b.run = run
    state.order = names
  }
  /** The handler of the `pcbjs:boards` event: every entry, each target of a board its own. */
  function takeBoards(p: BoardsMsg) {
    if (otherScope(p.scope)) return
    takeSets(p.boards, p.run ?? null)
    if (p.run !== undefined) live.run = p.run
    state.single = p.single
    state.errors = p.errors
    if (p.entries) state.entries = p.entries
  }

  // routes: <base> home, <base>board/<name>, <base>board/<name>/<slug>; with one entry the base shows the board
  /** Set the path without touching the history, for rendering a given URL. */
  function setPath(path: string) {
    state.path = path
  }
  const isHome = (path: string) => {
    const b = slash(base),
      p = path.replace(/[?#].*$/, '')
    return p === b || p + '/' === b || p === b + 'index.html'
  }
  const pathRoute = (): Route => {
    const r = routeFromPath(state.path, base)
    if (r.page === 'board') return r
    if (workspaceHome.value) return { page: 'home' }
    if (!isHome(state.path)) return { page: 'board', name: null, target: null }
    return state.single ? { page: 'board', name: groups.value[0]?.name ?? null, target: null } : { page: 'home' }
  }
  // IDE mode never shows the home page: the focused board or the first one stands in for it
  const route = computed<Route>(() =>
    ide.on
      ? ideRoute(
          pathRoute(),
          groups.value.map(g => g.name),
          ide.focused,
        )
      : pathRoute(),
  )
  /** The URL of a path: IDE and embed mode keep their query, so a reload stays in that mode. */
  const urlOf = (path: string) => pageUrl(path, { ide: ide.on, embed: embed.on }, ide.on ? ide.search : embed.search)
  /** Navigate to a path under the base with a new history entry. */
  function go(path: string) {
    if (path === state.path) return
    if (browser) history.pushState(null, '', urlOf(path))
    state.path = path
  }

  /** Every board with its targets, one group per board name, in entry order. */
  const groups = computed<BoardGroup[]>(() =>
    state.order.flatMap(name => {
      const b = boards.get(name)
      return b?.targets.length ? [{ name, targets: b.targets }] : []
    }),
  )
  /** The boards of the site, without the isolated preview: what the home page and the board menu list. */
  const siteGroups = computed<BoardGroup[]>(() => groups.value.filter(g => !g.targets[0]?.transient))
  /** The board the route names with all its targets, null on the home page or for an unknown name. */
  const currentGroup = computed(() => {
    const r = route.value
    return r.page === 'board' ? (groups.value.find(g => g.name === r.name) ?? null) : null
  })
  /** The target a board shows: the one it last showed, else its first. */
  function boardTarget(g: BoardGroup): SiteData | null {
    return pickTarget(g.targets, boards.get(g.name)?.target)
  }
  /** The entry shown: the current board at the target the route names, else at the target it last showed. */
  const current = computed(() => {
    const g = currentGroup.value,
      r = route.value
    if (!g || r.page !== 'board') return null
    return (r.target != null ? targetBySlug(g.targets, r.target) : null) ?? boardTarget(g)
  })
  /** The store of the board shown, null on the home page. */
  const shown = computed<BoardStore | null>(() => (currentGroup.value ? (boards.get(currentGroup.value.name) ?? null) : null))
  // the board shown follows the target the route names at once, so its views draw what the route shows
  watch(
    () => current.value && ([current.value.name, targetName(current.value)] as const),
    c => {
      if (c && boards.get(c[0])!.target !== c[1]) boards.get(c[0])!.target = c[1]
    },
    { flush: 'sync', immediate: true },
  )
  // another board: the transient things of the one left go, its own view state stays with it
  watch(
    () => shown.value?.name,
    (_, was) => {
      if (was && panes.has(was)) leavePane(panes.get(was)!)
    },
  )
  /** What this page shows, for the session's demand: the board, its target, the facets of the views it mounts, and its scope in a workspace. */
  function observing(): { board: string | null; target: string | null; scope?: string; facets: View[] } {
    const b = current.value
    const scope = workspace.scope != null ? { scope: workspace.scope } : {}
    if (!b) return { board: null, target: null, ...scope, facets: ['meta'] }
    const out = new Set<View>(mountedViews(pane(b.name)).flatMap(m => VIEW_FACETS[m]))
    // an editor that lists the findings itself
    if (ide.on && !ide.panel && pane(b.name).mode !== 'checks' && !board(b.name).sel.finding) out.delete('findings')
    // the assist's dots in 2D test the copper's rings
    if (edit.assist?.board === b.name) out.add('shapes')
    return { board: b.name, target: b.variant?.name ?? null, ...scope, facets: [...out] }
  }
  /** Show another target of a board; the URL follows. */
  function selectTarget(name: string, target: string | null) {
    board(name).target = target
    if (route.value.page === 'board' && route.value.name === name) go(boardHref(name, target))
  }
  // a board route to a board with several targets always names its target
  watchEffect(() => {
    const g = currentGroup.value,
      b = current.value,
      r = route.value
    if (!g || !b || r.page !== 'board' || g.targets.length < 2) return
    const t = targetName(b)
    if (t != null && r.target !== variantSlug(t) && routeFromPath(state.path, base).page === 'board') {
      const href = boardHref(g.name, t)
      if (browser) history.replaceState(history.state, '', urlOf(href))
      state.path = href
    }
  })
  /** The compile error that belongs to the current board: its entry's error, or the only entry's when there is one. */
  const currentError = computed(() => {
    const b = current.value
    if (b) return state.errors[state.entries[b.name]] ?? null
    if (state.single) return Object.values(state.errors)[0] ?? null
    // IDE mode has no home page to show a failed entry on: the first error stands in while no board compiled
    if (ide.on) return Object.values(state.errors).find(e => e) ?? null
    return null
  })

  const cards = computed<Card[]>(() => {
    const keys = Object.keys(state.errors)
    const card = (entry: string, g: BoardGroup | undefined, error: string | null): Card => ({ entry, board: g ? boardTarget(g) : null, targets: g?.targets ?? [], error })
    if (!keys.length) return siteGroups.value.map(g => card(state.entries[g.name] ?? '', g, null))
    const byEntry = new Map(siteGroups.value.map(g => [state.entries[g.name], g]))
    return keys.map(entry => card(entry, byEntry.get(entry), state.errors[entry]))
  })

  /** The title of the page, for the tab and the prerendered <title>. */
  const pageTitle = computed(() => {
    const r = route.value
    if (workspaceHome.value) return `pcbjs · ${scopeCards.value.length} projects`
    return r.page === 'home' ? `pcbjs · ${cards.value.length} boards` : current.value ? current.value.title || current.value.name : 'pcbjs'
  })

  // the theme starts unset on server and browser alike so hydration matches; afterMount applies the stored one
  const prefs: ViewPrefs = reactive({ grid: true, ratsnest: true, deep: false, theme: null })
  const system = reactive({ dark: false })
  /** The page's own overlays: the command palette, the key map and the toast. */
  const page = reactive({ palette: false, keymap: false, toast: null as { text: string; err: boolean; n: number } | null })

  /** The board selector's choice: the page switches to the board, and with an editor attached the editor opens its entry. */
  function chooseBoard(name: string) {
    go(boardHref(name))
    if (edit.mode?.editor) edit.client?.openEntry(name).catch(() => undefined)
  }

  if (ide.on && ide.theme) prefs.theme = ide.theme === 'light' ? 'light' : 'dark'
  /** Enter IDE mode, from the query the browser was opened with. */
  function enterIde(theme: IdeTheme | null, search: string) {
    ide.on = true
    ide.theme = theme
    ide.search = search
    const q = parseIdeQuery(search)
    ide.panel = q.panel
    ide.view = q.view
    if (theme) prefs.theme = theme === 'light' ? 'light' : 'dark'
  }
  /** The handler of the `pcbjs:focus` event: in IDE mode, show the board whose entry imports the editor's file. */
  function onFocus(e: FocusEvent) {
    if (!ide.on || !e) return
    // a file of another scope: the server shows that scope now, and so does this page
    if (e.scope && workspace.info && !workspace.info.single && e.scope !== workspace.scope) {
      toScope(e.scope)
      return
    }
    // the board shown before this focus counts, not the one the home path would now resolve to
    const r = route.value
    const next = focusSwitch(
      r.page === 'board' ? r.name : null,
      e,
      groups.value.map(g => g.name),
    )
    if (e.board) ide.focused = e.board
    if (!next) return
    go(boardHref(next))
    ide.flash++
  }
  /** The handler of the `pcbjs:scopes` event; in IDE mode a page with no scope yet follows the one the server shows. */
  function onScopes(i: ScopesMsg) {
    workspace.info = i
    if (ide.on && !i.single && workspace.scope == null && i.displayed) toScope(i.displayed)
  }
  /** Load the page of another scope, keeping the query; a scope is its own site with its own data. */
  function toScope(slug: string) {
    const card = workspace.info?.scopes.find(s => s.slug === slug)
    if (browser) location.assign((card?.route ?? `/${encodeURIComponent(slug)}/`) + (ide.on ? ide.search : ''))
  }
  function resolvedTheme(): Theme {
    return prefs.theme ?? (system.dark ? 'dark' : 'light')
  }
  function toggleTheme() {
    const next: Theme = resolvedTheme() === 'dark' ? 'light' : 'dark'
    // picking the system theme again goes back to following it
    prefs.theme = next === (system.dark ? 'dark' : 'light') ? null : next
    save('pcbjs:theme', prefs.theme)
  }
  function toggleGrid() {
    prefs.grid = !prefs.grid
    save('pcbjs:grid', prefs.grid ? null : '0')
  }
  function toggleRatsnest() {
    prefs.ratsnest = !prefs.ratsnest
    save('pcbjs:ratsnest', prefs.ratsnest ? null : '0')
  }

  // ---- the view query: ?view, explode, layer, select, side and mirror, applied to each board the first time it shows ----
  const query = shallowRef<ViewQuery | null>(null)
  const queried = new Set<string>()
  /** Apply the view query of the page; main.ts calls it after the first render, so hydration sees the state the server rendered. */
  function applyViewQuery(q: ViewQuery) {
    if (q.theme) prefs.theme = q.theme
    if (hasViewQuery(q)) query.value = q
  }
  watchEffect(() => {
    const q = query.value,
      b = current.value
    if (!q || !b || queried.has(b.name)) return
    queried.add(b.name)
    const v = pane(b.name),
      s = board(b.name)
    const mode = queryMode(q)
    if (mode) v.mode = mode
    if (q.side) v.side = q.side
    if (q.mirror !== null) v.mirror = q.mirror
    if (q.explode !== null) {
      v.explode = q.explode > 0
      if (q.explode > 0) v.separation = Math.round(q.explode * EXPLODE_MAX * 100) / 100
    }
    if (q.layer) {
      const hidden = soloHidden(b.layers, q.layer)
      if (hidden) v.hidden = new Set(hidden)
      else console.warn(`pcbjs: ?layer=${q.layer} matches no layer of ${b.name}`)
    }
    // the isolation first, so what ?select= names is selected inside it
    if (q.isolate) {
      s.isolateRef(q.isolate)
      if (q.isolateMode && s.sel.isolate) s.setSel({ ...s.sel, isolate: { ...s.sel.isolate, mode: q.isolateMode } }, 'url')
    }
    if (q.focus) {
      const finding = [...b.drc, ...b.erc].find(f => f.id === q.focus)
      if (finding) s.focusFinding(finding)
    }
    const why = q.select ? s.selectRef(q.select, !q.isolate, 'url') : null
    if (why) console.warn(`pcbjs: ?select=${q.select} on ${b.name}: ${why}`)
  })

  /** Apply what the editor or the embedding page posted; explicit board and target identity switches before the action. */
  async function applyRequest(r: IdeRequest) {
    if (r.kind === 'theme') {
      prefs.theme = r.theme
      return
    }
    const name = r.board ?? current.value?.name
    if (r.board || 'target' in r) {
      const group = groups.value.find(g => g.name === name)
      const target = 'target' in r ? (r.target === null ? group?.targets[0] : group?.targets.find(t => targetName(t) === r.target)) : null
      if (!group || ('target' in r && !target)) return showToast(`Board action unavailable: ${name}/${r.target ?? 'first'} is no longer available`, true)
      if (target) board(group.name).target = targetName(target)
      go(boardHref(group.name, target ? targetName(target) : board(group.name).target))
      await nextTick()
      if (current.value?.name !== group.name || (target && targetName(current.value) !== targetName(target))) return
    }
    const b = current.value
    if (!b) return
    const s = board(b.name),
      v = pane(b.name)
    if (r.kind === 'net') s.setSel(r.net ? selectRefs(s.sel, [`net:${r.net}`]) : { ...s.sel, refs: [], anchor: null })
    else if (r.kind === 'finding') {
      const d = [...b.drc, ...b.erc].find(m => m.id === r.id)
      if (!d) return console.warn(`pcbjs: no finding ${r.id} on ${b.name}`)
      s.focusFinding(d)
      const sch = schFindingAt(d)
      const at = markAt(d)
      if (v.mode === 'sch' && sch) v.schFocus = focusAt(sch, 2, true)
      else if (v.mode === '2d' && !sch && at) v.focus = focusAt(at, 2, true)
    } else if (r.kind === 'hover') {
      const hover = fromWire(b, r.hover)
      s.remote = hover ? { board: b.name, hover } : null
    } else if (r.kind === 'view') {
      if (r.view) v.mode = r.view
      if (r.side) v.side = r.side
      if (r.mirror !== null) v.mirror = r.mirror
    } else {
      const before = s.selection()
      const text = r.refs?.length ? r.refs.join(',') : null
      const why = s.selectRef(text, r.frame, r.by)
      if (why) console.warn(`pcbjs: select ${text} on ${b.name}: ${why}`)
      const after = s.selection()
      if (after !== before) embed.asked.ref = after
    }
  }

  /** the agents attached to the session, from `pcbjs:agents`, and how this page sends one its selection; `send` is null outside dev */
  const agents = reactive({
    list: [] as AgentInfo[],
    send: null as ((to: string, req: SendRequest, comment: string) => void) | null,
  })

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let toastN = 0
  function showToast(text: string, err = false) {
    page.toast = { text, err, n: ++toastN }
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      page.toast = null
    }, 2500)
  }

  let undoing = false
  /** IDE panes use source-document history; standalone pages use their own session transactions. */
  function undoEdit(redo: boolean): boolean {
    if (edit.dragging || undoing) return true
    if (browser && ide.on && window.parent !== window) {
      const name = current.value?.name
      if (!name) return true
      const project = undoProject(workspace.info, workspace.scope)
      const files = edit.undoFiles.get(undoKey(name, project))
      const entry = state.entries[name]
      const fallback = entry && project && !/^(?:[A-Za-z]:[\\/]|\/)/.test(entry) ? `${project.replace(/[\\/]$/, '')}/${entry}` : entry
      window.parent.postMessage({ type: 'pcbjs:undo', board: name, ...(project ? { project } : {}), files: files ? [...files] : fallback ? [fallback] : [], redo }, '*')
      return true
    }
    const client = edit.client
    if (!client) return false
    const step = undoStep(edit, redo, { session: (txn, r) => client.undo(txn, r) })
    if (!step) return false
    undoing = true
    void step.then(err => {
      undoing = false
      if (err) editNote(edit, err, true)
    })
    return true
  }

  const commands = markRaw(commandBus())
  // the boards the page came with
  takeSets(init.boards ?? [], init.run ?? null)

  const shell = {
    base,
    homeHref,
    boardHref,
    asset,
    state,
    boards,
    board,
    adopt,
    pane,
    context,
    edit,
    take,
    held,
    invalidate,
    status,
    takeBoards,
    takeSets,
    live,
    observing,
    setPath,
    route,
    go,
    groups,
    siteGroups,
    currentGroup,
    boardTarget,
    current,
    shown,
    selectTarget,
    chooseBoard,
    currentError,
    cards,
    pageTitle,
    workspace,
    workspaceHome,
    scopeCards,
    onScopes,
    toScope,
    prefs,
    system,
    page,
    resolvedTheme,
    toggleTheme,
    toggleGrid,
    toggleRatsnest,
    /** the key map's commands, which the views and the palette run */
    commands,
    ide,
    embed,
    applyRequest,
    enterIde,
    onFocus,
    agents,
    showToast,
    undoEdit,
    applyViewQuery,
  }
  return shell
}

/** After the first render: the stored theme and preferences, then the view query, whose theme wins without being stored. */
export function afterMount(shell: Shell, query?: ViewQuery) {
  const { prefs, system, ide } = shell
  // in IDE mode the editor's theme wins over the stored one, and is never stored; an embedded page follows its query and its parent
  const stored = (ide.on && ide.theme) || shell.embed.on ? null : load('pcbjs:theme')
  if (stored === 'light' || stored === 'dark') prefs.theme = stored
  if (load('pcbjs:grid') === '0') prefs.grid = false
  if (load('pcbjs:ratsnest') === '0') prefs.ratsnest = false
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  system.dark = media?.matches ?? false
  media?.addEventListener('change', e => {
    system.dark = e.matches
  })
  // the inline script in index.html set the stored theme before the first paint; from here the page owns it
  shell.run(() =>
    watchEffect(() => {
      const el = document.documentElement
      if (prefs.theme) el.dataset.theme = prefs.theme
      else delete el.dataset.theme
      if (ide.on && ide.theme === 'hc') el.dataset.contrast = 'high'
      else delete el.dataset.contrast
    }),
  )
  if (query) shell.applyViewQuery(query)
}

/** The key of a board target in the page's facet streams. */
export { facetKey }
