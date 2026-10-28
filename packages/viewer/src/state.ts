// kept apart from main.ts so components import the store without a cycle through App.vue; one store per render
import type { HoverMsg, HoverTarget } from './sync'
import { computed, effectScope, inject, reactive, shallowRef, watch, watchEffect, type InjectionKey } from 'vue'
import type { SiteData, SourceRange } from '@pcbjs/core/site-data'
import {
  clickAction,
  followHint,
  followOf,
  openQuery,
  padOf,
  refsOfIds,
  repoUrl,
  resolveCursor,
  sourceTarget,
  itemsIn,
  targetHighlight,
  type CursorTarget,
  type ClickAction,
  type FollowMode,
  type SourceKind,
  type SourceTarget,
} from './source'
export { sourceTarget }
export type { ClickAction, FollowMode, SourceKind, SourceTarget }
import { focusSwitch, ideRoute, pageUrl, parseIdeQuery, parseIdeRequest, type FocusEvent, type IdeRequest, type IdeTheme } from './ide'
import { EXPLODE_MAX, hasViewQuery, queryMode, soloHidden, type ViewQuery } from './query'
import { schAtCursor } from './schview'
import {
  appBase,
  assetUrl,
  boardPath,
  checkSummary,
  drcSummary,
  groupBoards,
  hashToPath,
  isAppPath,
  pickTarget,
  routeFromPath,
  sameEntry,
  targetBySlug,
  targetName,
  upsertEntry,
  variantSlug,
  type BoardGroup,
} from './variants'
export { checkSummary, drcSummary }
export type { FocusEvent, IdeTheme }

type Box = [number, number, number, number]
// nothing at the top level may need a DOM, so the app can be rendered without one; every browser global is behind this
const browser = typeof window !== 'undefined' && typeof document !== 'undefined'
const slash = (b: string) => (b.endsWith('/') ? b : b + '/')

/** The site data a store starts from: what the virtual module, the inlined `window.__PCBJS_DATA__` or the prerenderer hands over. */
export interface SiteState {
  boards?: SiteData[]
  single?: boolean
  /** the last compile error of each entry, keyed by entry path, in entry order */
  errors?: Record<string, string | null>
  /** the entry each board came from, keyed by board name */
  entries?: Record<string, string>
}
/** One scope of a workspace dev server, as /__pcbjs/scopes and the `pcbjs:scopes` event list it. */
export interface ScopeCard {
  slug: string
  name: string
  dir: string
  route: string
  status: 'unloaded' | 'ok' | 'incomplete' | 'error'
  stale: boolean
  displayed: boolean
  error: string | null
  boards: { name: string; title: string; entry: string; status: string }[]
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
/** What a workspace dev server says about its scopes; `displayed` is the scope HMR follows. */
export interface WorkspaceInfo {
  single: boolean
  displayed: string | null
  scopes: ScopeCard[]
}
export interface StoreInit extends SiteState {
  /** a workspace dev server's scopes, from the virtual module */
  workspace?: WorkspaceInfo | null
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
export type Focus = { at: [number, number]; r: number; n: number; pulse: boolean }
export type Tab = 'drc' | 'erc' | 'schematic' | 'bom' | 'nets' | 'part'
export type Theme = 'light' | 'dark'
export type Mode = '2d' | '3d' | 'sch'

/** What each board remembers while another one is shown or the code reloads. */
export interface BoardViewState {
  hidden: Set<string>
  pinnedNet: string | null
  activeRef: string | null
  /** a multi-part selection, a circuit instance's; [] for none */
  selectedRefs: string[]
  /** the selected circuit instance, by its path joined with "/", null for none */
  activeCircuit: string | null
  /** the circuit instances open in the Schematic tab's tree, by the same key */
  expanded: Set<string>
  tab: Tab
  mode: Mode
  /** the schematic's hidden rail rows, see SCH_LAYERS */
  schHidden: Set<string>
  /** the 2D board shown beside the schematic */
  split: boolean
  /** the board seen from below: the 2D view mirrored to the back, and the 3D view opening on the bottom */
  flipped: boolean
  /** the 3D view's focus fade, exploded view and layer separation in mm, kept while 2D is shown and across targets */
  fade: boolean
  explode: boolean
  separation: number
  /** the target shown, by variant name; null for the first, and for a board without variants */
  target: string | null
}
export interface BoardsEvent {
  boards: SiteData[]
  single: boolean
  errors: Record<string, string | null>
  entries?: Record<string, string>
  scope?: string
}
/** The items a range of code produced; `col` and `seg` name one command of a path string, such as "H 9". */
export interface SourceHighlight {
  board: string
  file: string
  line: number
  col?: number
  seg?: string
  ids: number[]
  refs: string[]
  n: number
  /** the schematic elements the range drew, see schAtCursor */
  sch?: string[]
  /** board points to mark and a reference to outline, for a target the language server resolved */
  points?: [number, number][]
  reference?: string
  /** what the target is, `pad Q1.2`, shown instead of the file and line */
  label?: string
}
export interface CursorEvent {
  file: string
  line: number
  col: number
  target?: CursorTarget
}
/** One card per entry in entry order, with the board it last compiled to, the board's targets in order, and its error. */
export interface Card {
  entry: string
  board: SiteData | null
  targets: SiteData[]
  error: string | null
}

// storage can throw in private windows or with blocked site data, so every access is guarded
export function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export function save(key: string, value: string | null) {
  try {
    value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value)
  } catch {
    /* not persisted */
  }
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
// set once by setFollow before the app mounts; the prerenderer keeps the default
let follow: FollowMode = 'click'
/** The HUD hint of the follow mode: shown while a click would open a source link. */
export let linkHint = followHint(follow, isMac)
export function setFollow(f: FollowMode) {
  follow = f
  linkHint = followHint(f, isMac)
}
export const followMode = (): FollowMode => follow
/** The platform's link key, cmd on macOS and ctrl elsewhere. */
export const platformLinkKey = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey)
/** True when a click opens a source link: always with 'click', with the link key held with 'meta-click'. */
export const linkKey = (e: { metaKey: boolean; ctrlKey: boolean }) => follow === 'click' || platformLinkKey(e)
/** The link a click opens: shift asks for the definition, the innermost range, instead of the placement. */
export const linkKind = (e: { shiftKey: boolean }): SourceKind => (e.shiftKey ? 'definition' : 'placement')
/** What a click on an item does under the page's follow mode. */
export const clickOf = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): ClickAction => clickAction(follow, e, isMac)

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
const within = (s: { line: number; col: number; endLine?: number; endCol?: number }, r: SourceRange) =>
  (s.line > r.start[0] || (s.line === r.start[0] && s.col >= r.start[1])) &&
  ((s.endLine ?? s.line) < r.end[0] || ((s.endLine ?? s.line) === r.end[0] && (s.endCol ?? s.col) <= r.end[1]))

/** The footprint refs a highlight touches, directly or through its item ids, for the 3D view. */
export function highlightRefs(board: SiteData, h: SourceHighlight): Set<string> {
  const refs = refsOfIds(board, h.ids)
  for (const r of h.refs) refs.add(r)
  return refs
}

/** Ask the dev server to open a file in the editor; Vite's own endpoint is the fallback for a server without /__pcbjs/open. */
export async function openInEditor(t: SourceTarget): Promise<boolean> {
  try {
    const r = await fetch(`/__pcbjs/open?${openQuery(t.file, t)}`)
    if (r.ok) return true
    if (r.status === 404 && t.abs) return (await fetch(`/__open-in-editor?file=${encodeURIComponent(`${t.abs}:${t.start[0]}:${t.start[1]}`)}`)).ok
    return false
  } catch {
    return false
  }
}

/** A fresh viewer state. Every watcher it makes belongs to it and stops with `stop()`. */
export function createStore(init: StoreInit = {}) {
  const scope = effectScope(true)
  const store = scope.run(() => makeStore(init))!
  return { ...store, stop: () => scope.stop() }
}
export type Store = ReturnType<typeof createStore>

/** The key the app provides its store under; a global symbol so a hot reload of this file still finds the store App.vue was given. */
export const STORE = Symbol.for('pcbjs:store') as InjectionKey<Store>
export function useStore(): Store {
  const s = inject(STORE, null)
  if (!s) throw new Error('pcbjs: no store provided, call app.provide(STORE, createStore(...))')
  return s
}

function makeStore(init: StoreInit) {
  // `/` in dev; a site built with a relative base finds it from the page's path
  const base = appBase(init.baseUrl ?? import.meta.env?.BASE_URL ?? '/', init.path ?? '/')
  const homeHref = base
  const boardHref = (name: string, target?: string | null) => boardPath(base, name, target)
  // relative URLs resolve under the base so they work from every route
  const asset = (url: string) => assetUrl(url, base)

  const state = reactive({
    boards: [...(init.boards ?? [])] as SiteData[],
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
    /** the last request the editor posted, numbered so a repeat still fires */
    request: null as (IdeRequest & { n: number }) | null,
    /** the board the editor last focused, shown for the home path */
    focused: null as string | null,
    /** counts board switches by focus, for the flash of the board name */
    flash: 0,
  })
  let requestN = 0

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
  const workspace = reactive({ info: (init.workspace ?? null) as WorkspaceInfo | null, scope: (init.scope ?? null) as string | null })
  const workspaceHome = computed(() => !!workspace.info && !workspace.info.single && workspace.scope == null)
  const scopeCards = computed<ScopeCard[]>(() => workspace.info?.scopes ?? [])
  /** True when the dev server follows another scope than this page's, whose board events are then not for it. */
  const otherScope = (scope?: string | null) => workspace.scope != null && (scope ?? workspace.info?.displayed ?? workspace.scope) !== workspace.scope

  // a plain map of reactive entries, so asking for a new board's state inside a computed does not trigger anything
  const views: Record<string, BoardViewState> = {}
  function boardView(name: string): BoardViewState {
    return (views[name] ??= reactive(
      pinMode({
        hidden: new Set<string>(),
        pinnedNet: null,
        activeRef: null,
        selectedRefs: [],
        activeCircuit: null,
        expanded: new Set<string>(),
        tab: 'drc',
        mode: defaultMode(),
        schHidden: new Set<string>(),
        split: false,
        flipped: false,
        fade: true,
        explode: false,
        separation: 4,
        target: null,
      }),
    ) as BoardViewState)
  }
  /** An editor pane opened on one view keeps it: a finding or a selection never switches it. */
  function pinMode<T extends { mode: Mode }>(v: T): T {
    const fixed = ide.on ? ide.view : null
    if (fixed) Object.defineProperty(v, 'mode', { enumerable: true, get: () => fixed, set: () => {} })
    return v
  }
  /** The view a board starts in: 3D while editing, in the dev server, in IDE mode and embedded, 2D in a built site. */
  function defaultMode(): '2d' | '3d' {
    return ide.on || embed.on || (import.meta as any).env?.DEV === true || state.boards.some(b => b.dev) ? '3d' : '2d'
  }

  /** The handler of the `pcbjs:board` HMR event: one entry, a board or one target of it, replaces the entry with the same name and target. */
  function applyBoard(data: SiteData) {
    if (otherScope()) return
    upsertEntry(state.boards, data)
    const entry = state.entries[data.name]
    if (entry) state.errors[entry] = null
    state.updatedAt = Date.now()
  }
  /** The handler of the `pcbjs:boards` HMR event: every entry, each target of a board its own. */
  function applyBoards(p: BoardsEvent) {
    if (otherScope(p.scope)) return
    // unchanged entries keep their object, so nothing downstream re-renders for them
    state.boards = p.boards.map(b => state.boards.find(o => sameEntry(o, b) && o.generatedAt === b.generatedAt && !!o.stale === !!b.stale) ?? b)
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
    return state.single ? { page: 'board', name: state.boards[0]?.name ?? null, target: null } : { page: 'home' }
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

  /** Every board with its targets, one group per board name, in entry order, the isolated preview of IDE mode last. */
  const groups = computed<BoardGroup[]>(() => groupBoards(state.boards))
  /** The boards of the site, without the isolated preview: what the home page and the board menu list. */
  const siteGroups = computed<BoardGroup[]>(() => groups.value.filter(g => !g.targets[0]?.transient))
  /** The board the route names with all its targets, null on the home page or for an unknown name. */
  const currentGroup = computed(() => {
    const r = route.value
    return r.page === 'board' ? (groups.value.find(g => g.name === r.name) ?? null) : null
  })
  /** The target a board shows: the one it last showed, else its first. */
  function boardTarget(g: BoardGroup): SiteData | null {
    return pickTarget(g.targets, boardView(g.name).target)
  }
  /** The entry shown: the current board at the target the route names, else at the target it last showed. */
  const current = computed(() => {
    const g = currentGroup.value,
      r = route.value
    if (!g || r.page !== 'board') return null
    return (r.target != null ? targetBySlug(g.targets, r.target) : null) ?? boardTarget(g)
  })
  /** Show another target of a board; the URL follows. */
  function selectTarget(name: string, target: string | null) {
    boardView(name).target = target
    if (route.value.page === 'board' && route.value.name === name) go(boardHref(name, target))
  }
  // the target in the URL becomes the board's remembered one, and a board route to a board with several targets always names its target
  watchEffect(() => {
    const g = currentGroup.value,
      b = current.value,
      r = route.value
    if (!g || !b || r.page !== 'board' || g.targets.length < 2) return
    const t = targetName(b)
    const v = boardView(g.name)
    if (v.target !== t) v.target = t
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

  // each board's 2D frame in mm, outside Vue: it changes on every pan step and nothing renders from it
  const viewports: Record<string, Box> = {}

  // the theme starts unset on server and browser alike so hydration matches; main.ts applies the stored one after
  const ui = reactive({
    hoverNet: null as string | null,
    /** the parts of the circuit instance under the pointer in the Schematic tab, drawn faintly on the board */
    hoverRefs: [] as string[],
    // null follows prefers-color-scheme
    theme: null as Theme | null,
    /** what is under the pointer in the 2D view, for the schematic */
    probe: null as { ref: string | null; net: string | null; id: number | null } | null,
    /** what the pointer is on in this page, sent to the other viewers */
    hoverItem: null as HoverTarget | null,
    /** what the pointer is on in another viewer of this board, drawn as a hover without the bubble */
    remote: null as HoverMsg | null,
    /** the part ?select= asks both views to frame, by board */
    frame: null as { board: string; ref: string } | null,
    /** the background grid of every view */
    grid: true,
  })
  const system = reactive({ dark: false })

  if (ide.on && ide.theme) ui.theme = ide.theme === 'light' ? 'light' : 'dark'
  /** Enter IDE mode, from the query the browser was opened with. */
  function enterIde(theme: IdeTheme | null, search: string) {
    ide.on = true
    ide.theme = theme
    ide.search = search
    const q = parseIdeQuery(search)
    ide.panel = q.panel
    ide.view = q.view
    if (theme) ui.theme = theme === 'light' ? 'light' : 'dark'
  }
  /** The handler of the `pcbjs:focus` HMR event: in IDE mode, show the board whose entry imports the editor's file. */
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
  function onScopes(i: WorkspaceInfo) {
    workspace.info = i
    if (ide.on && !i.single && workspace.scope == null && i.displayed) toScope(i.displayed)
  }
  /** Load the page of another scope, keeping the query; a scope is its own site with its own data. */
  function toScope(slug: string) {
    const card = workspace.info?.scopes.find(s => s.slug === slug)
    if (browser) location.assign((card?.route ?? `/${encodeURIComponent(slug)}/`) + (ide.on ? ide.search : ''))
  }
  function resolvedTheme(): Theme {
    return ui.theme ?? (system.dark ? 'dark' : 'light')
  }
  function toggleTheme() {
    const next: Theme = resolvedTheme() === 'dark' ? 'light' : 'dark'
    // picking the system theme again goes back to following it
    ui.theme = next === (system.dark ? 'dark' : 'light') ? null : next
    save('pcbjs:theme', ui.theme)
  }
  function toggleGrid() {
    ui.grid = !ui.grid
    save('pcbjs:grid', ui.grid ? null : '0')
  }

  // ---- the view query: ?view, explode, layer, select and side, applied to each board the first time it shows ----
  const query = shallowRef<ViewQuery | null>(null)
  const queried = new Set<string>()
  /** Apply the view query of the page; main.ts calls it after the first render, so hydration sees the state the server rendered. */
  function applyViewQuery(q: ViewQuery) {
    if (q.theme) ui.theme = q.theme
    if (hasViewQuery(q)) query.value = q
  }
  watchEffect(() => {
    const q = query.value,
      b = current.value
    if (!q || !b || queried.has(b.name)) return
    queried.add(b.name)
    const v = boardView(b.name)
    const mode = queryMode(q)
    if (mode) v.mode = mode
    if (q.side) v.flipped = q.side === 'bottom'
    if (q.explode !== null) {
      v.explode = q.explode > 0
      if (q.explode > 0) v.separation = Math.round(q.explode * EXPLODE_MAX * 100) / 100
    }
    if (q.layer) {
      const hidden = soloHidden(b.layers, q.layer)
      if (hidden) v.hidden = new Set(hidden)
      else console.warn(`pcbjs: ?layer=${q.layer} matches no layer of ${b.name}`)
    }
    if (q.select && !selectPart(b, q.select, true)) console.warn(`pcbjs: ?select=${q.select} matches no part of ${b.name}`)
  })

  /** Select a part as ?select= does, null clears; `frame` also frames it in every view. False when the board has no such part. */
  function selectPart(b: SiteData, ref: string | null, frame: boolean): boolean {
    if (ref != null && !b.footprints.some(f => f.ref === ref)) return false
    const v = boardView(b.name)
    v.activeRef = ref
    v.activeCircuit = null
    v.selectedRefs = []
    if (ref) v.tab = 'part'
    if (ref && frame) ui.frame = { board: b.name, ref }
    return true
  }

  /** Apply what the editor or the embedding page posted; a net or a finding goes to App.vue through `ide.request`. */
  function applyRequest(r: IdeRequest) {
    const b = current.value
    if (r.kind === 'net' || r.kind === 'finding') ide.request = { ...r, n: ++requestN }
    else if (r.kind === 'theme') ui.theme = r.theme
    else if (!b) return
    else if (r.kind === 'hover') ui.remote = r.hover ? { board: b.name, hover: r.hover } : null
    else if (r.kind === 'view') boardView(b.name).mode = r.view
    else {
      if (boardView(b.name).activeRef !== r.ref) embed.asked.ref = r.ref
      if (!selectPart(b, r.ref, r.frame)) {
        embed.asked.ref = undefined
        console.warn(`pcbjs: select ${r.ref} matches no part of ${b.name}`)
      }
    }
  }

  /** How a click follows to the source, from the site data; every board of a site carries the same. */
  const followSetting = computed<FollowMode>(() => followOf(current.value ?? state.boards[0]))
  /** True when the current board has somewhere to open a source link: the editor in dev, the repository in a built site. */
  const linksAvailable = computed(() => !!(current.value && (current.value.dev || current.value.repo)))
  const source = reactive({
    highlight: null as SourceHighlight | null,
    /** true while a click would open a source link, for the HUD hint: the link key is held, or always with `follow: 'click'` when there is somewhere to go */
    meta: false,
    /** true while shift is held with it, so the hint names the definition instead of the placement */
    shift: false,
    toast: null as { text: string; err: boolean; n: number } | null,
  })

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let toastN = 0
  function showToast(text: string, err = false) {
    source.toast = { text, err, n: ++toastN }
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      source.toast = null
    }, 2500)
  }

  // no hold: a cursor that leaves every range clears the highlight at once
  const segOf = (r: SourceRange) => (r.seg !== undefined ? { col: r.start[1], seg: r.seg } : {})
  let hlN = 0
  function setHighlight(h: Omit<SourceHighlight, 'n'>) {
    source.highlight = { ...h, n: ++hlN }
  }
  function clearSourceHighlight() {
    source.highlight = null
  }

  /** The handler of the `pcbjs:cursor` HMR event: highlight what the code under the editor cursor produced on the current board. */
  function onSourceCursor(p: CursorEvent) {
    const b = current.value
    // the innermost token the language server resolved wins over the range around it
    const t = b?.dev ? targetHighlight(p?.target, b.name) : null
    if (b && t) {
      const h = source.highlight
      if (h && h.board === b.name && h.label === t.label && sameList(h.ids, t.ids) && sameList(h.refs, t.refs)) return
      setHighlight({ board: b.name, file: p.file, line: p.line, ...t })
      return
    }
    const drawn = b?.dev && p?.file && b.schematic?.drawing ? schAtCursor(b.schematic.drawing, p.file, p.line, p.col) : null
    const hit = b?.dev && b.sources && p?.file ? resolveCursor(b.sources, p.file, p.line, p.col) : null
    // a schematic element inside a board range, such as a <Sym> in the <PCB>, wins: it is the innermost code
    if (b && drawn && (!hit || !(hit.ids.length || hit.refs.length) || within(drawn.src, hit.range))) {
      const h = source.highlight
      if (h && h.board === b.name && h.file === drawn.src.file && h.line === drawn.src.line && sameList(h.sch ?? [], drawn.keys)) return
      setHighlight({ board: b.name, file: drawn.src.file, line: drawn.src.line, ids: [], refs: drawn.refs, sch: drawn.keys })
      return
    }
    if (hit && b && (hit.ids.length || hit.refs.length)) {
      // the same range again, as each keystroke inside one call sends: the views keep what they drew
      const h = source.highlight
      if (
        h &&
        h.board === b.name &&
        h.file === hit.file &&
        h.line === hit.range.start[0] &&
        h.col === segOf(hit.range).col &&
        sameList(h.ids, hit.ids) &&
        sameList(h.refs, hit.refs)
      )
        return
      setHighlight({ board: b.name, file: hit.file, line: hit.range.start[0], ...segOf(hit.range), ids: hit.ids, refs: hit.refs })
      return
    }
    if (source.highlight) source.highlight = null
  }

  /** Highlight the items of one range of the current board, as the editor cursor would. */
  function showSourceRange(board: SiteData, file: string, range: SourceRange) {
    const items = itemsIn(board.sources?.[file] ?? [range], range)
    setHighlight({ board: board.name, file, line: range.start[0], ...segOf(range), ...items })
  }

  /** Open a source link: the editor in dev, the repository host in a built site; `quiet` says nothing unless opening failed. */
  async function openSource(board: SiteData, item: { id?: number | null; ref?: string | null }, kind: SourceKind = 'placement', quiet = false) {
    const t = sourceTarget(board, item, kind)
    const num = t && board.dev && kind === 'placement' && item.id != null && item.ref ? padOf(board, item.id) : null
    await openTarget(board, t && num !== null ? { ...t, pad: `${item.ref}.${num}`, board: board.name } : t, quiet)
  }
  /** Open a known source location, as openSource does for an item. */
  async function openTarget(board: SiteData, t: SourceTarget | null, quiet = false) {
    if (!t) {
      if (!quiet) showToast('No source location', true)
      return
    }
    if (board.dev) {
      const ok = await openInEditor(t)
      if (!ok || !quiet) showToast(ok ? 'Opened in editor' : `Could not open ${t.file}:${t.start[0]}`, !ok)
    } else if (board.repo) {
      window.open(repoUrl(board.repo, t.file, { start: t.start, end: t.end ?? t.start }), '_blank', 'noopener')
    } else if (!quiet) showToast('No source location', true)
  }

  return {
    base,
    homeHref,
    boardHref,
    asset,
    state,
    boardView,
    applyBoard,
    applyBoards,
    setPath,
    route,
    go,
    groups,
    siteGroups,
    followSetting,
    linksAvailable,
    currentGroup,
    boardTarget,
    current,
    selectTarget,
    currentError,
    cards,
    pageTitle,
    workspace,
    workspaceHome,
    scopeCards,
    onScopes,
    toScope,
    viewports,
    ui,
    system,
    resolvedTheme,
    toggleTheme,
    toggleGrid,
    ide,
    embed,
    applyRequest,
    enterIde,
    onFocus,
    source,
    showToast,
    clearSourceHighlight,
    onSourceCursor,
    showSourceRange,
    openSource,
    openTarget,
    applyViewQuery,
  }
}

/** Wire a store to the page before the app mounts; true when an old `#/board/<name>` hash moved the page elsewhere. */
export function startBrowser(store: Store): boolean {
  const { state } = store
  const hot = import.meta.hot
  // ?ide=1 is read before the first render, never during one; a store made without it still enters IDE mode here
  if (!store.ide.on) {
    const q = parseIdeQuery(location.search)
    if (q.ide) store.enterIde(q.theme, location.search)
  }
  if (hot) {
    hot.on('pcbjs:board', (data: SiteData) => store.applyBoard(data))
    hot.on('pcbjs:boards', (p: BoardsEvent) => store.applyBoards(p))
    hot.on('pcbjs:cursor', (p: CursorEvent) => store.onSourceCursor(p))
    hot.on('pcbjs:focus', (e: FocusEvent) => store.onFocus(e))
    hot.on('pcbjs:scopes', (i: WorkspaceInfo) => store.onScopes(i))
    // the editor may have moved before this page opened: the server answers with the last focus and cursor
    if (store.ide.on) {
      const shown = () => {
        const r = store.route.value
        return r.page === 'board' ? r.name : null
      }
      hot.send('pcbjs:viewer:hello', { board: shown() })
      watch(shown, name => hot.send('pcbjs:viewer:board', { name }))
    }
    hot.on('pcbjs:error', (e: { name: string | null; entry: string; message: string; text?: string }) => {
      state.errors = { ...state.errors, [e.entry]: e.text || e.message }
    })
  }

  // only the editor or the page around the page may post requests
  if ((store.ide.on || store.embed.on) && window.parent !== window) {
    addEventListener('message', e => {
      const r = e.source === window.parent ? parseIdeRequest(e.data) : null
      if (r) store.applyRequest(r)
    })
  }

  // a built site without the inlined data: boards.json next to index.html, then each board's JSON
  if (!state.boards.length && !hot && !Object.keys(state.errors).length) {
    state.loading = true
    fetch(store.asset('boards.json'))
      .then(r => r.json())
      .then(async (idx: { boards: { name: string; file: string; entry: string; variant?: string }[]; single: boolean }) => {
        state.single = idx.single
        state.entries = Object.fromEntries(idx.boards.map(b => [b.name, b.entry]))
        state.boards = await Promise.all(idx.boards.map(b => fetch(store.asset(b.file)).then(r => r.json() as Promise<SiteData>)))
      })
      .catch(() => {})
      .finally(() => {
        state.loading = false
      })
  }

  const old = location.hash ? hashToPath(location.hash, store.base) : null
  if (old) {
    history.replaceState(history.state, '', old)
    state.path = old
  }
  addEventListener('popstate', () => {
    state.path = location.pathname
  })
  // links to routes stay real <a href> for middle-click and copy link; a plain click navigates in place
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
    const url = new URL(a.href)
    if (url.origin !== location.origin || !isAppPath(url.pathname, store.base)) return
    e.preventDefault()
    store.go(url.pathname)
  })

  // the follow mode of the site, before the app mounts, so the hint and the click handlers agree from the first click
  setFollow(store.followSetting.value)
  watch(store.followSetting, f => setFollow(f))
  const sync = (e: KeyboardEvent | MouseEvent) => {
    const m = follow === 'click' ? store.linksAvailable.value : platformLinkKey(e),
      s = m && e.shiftKey
    if (m !== store.source.meta) store.source.meta = m
    if (s !== store.source.shift) store.source.shift = s
  }
  addEventListener('keydown', sync)
  addEventListener('keyup', sync)
  addEventListener('pointermove', sync, { passive: true })
  addEventListener('blur', () => {
    store.source.meta = false
    store.source.shift = false
  })

  watchEffect(() => {
    document.title = store.pageTitle.value
  })
  return !!old
}

/** After the first render: the stored theme, then the view query, whose theme wins without being stored. */
export function afterMount(store: Store, query?: ViewQuery) {
  const { ui, system } = store
  const { ide } = store
  // in IDE mode the editor's theme wins over the stored one, and is never stored; an embedded page follows its query and its parent
  const stored = (ide.on && ide.theme) || store.embed.on ? null : load('pcbjs:theme')
  if (stored === 'light' || stored === 'dark') ui.theme = stored
  if ((load('pcbjs:grid') ?? load('pcbjs.3d.grid')) === '0') ui.grid = false
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  system.dark = media?.matches ?? false
  media?.addEventListener('change', e => {
    system.dark = e.matches
  })
  // the inline script in index.html set the stored theme before the first paint; from here the store owns it
  watchEffect(() => {
    const el = document.documentElement
    if (ui.theme) el.dataset.theme = ui.theme
    else delete el.dataset.theme
    if (ide.on && ide.theme === 'hc') el.dataset.contrast = 'high'
    else delete el.dataset.contrast
  })
  if (query) store.applyViewQuery(query)
}
