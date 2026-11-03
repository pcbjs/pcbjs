// A board as the components take it: site data, a `?pcb:board` ref whose facets load as views need them, or its store. Components
// given the same board share one BoardStore and one pane, so two views share selection and hover with no provider.
import { effectScope, markRaw, onMounted, provide, reactive, toRaw } from 'vue'
import type { SiteData } from '@pcbjs/core/site-data'
import { facetHash, facetSet, type BoardRef, type FacetName } from '@pcbjs/core/site-facets'
import { createBoard, wanted, type BoardStore } from './board-store'
import { createPane, paneEffects } from './pane'
import { commandBus } from './keys'
import { injectPane, PANE, type PaneContext, type ViewPrefs } from './context'
import { openTarget } from './open'
import { connectBoard } from './connect'
import { sessionSocket, type Transport } from './transport'

export type BoardInput = BoardRef | BoardStore | SiteData

const isRef = (b: BoardInput): b is BoardRef => (b as BoardRef).kind === 'pcbjs-board'
const isStore = (b: BoardInput): b is BoardStore => typeof (b as BoardStore).take === 'function'
const refKey = (r: Pick<BoardRef, 'entry' | 'board' | 'target'>) => `${r.entry}\0${r.board}\0${r.target ?? ''}`

// on globalThis, so the `?pcb:board` module a dev server hot-replaces finds the stores an earlier copy made
const REGISTRY = Symbol.for('pcbjs.boards')
interface Registry {
  refs: Map<string, BoardStore>
  sites: WeakMap<SiteData, BoardStore>
  /** A live ref's module, as its dev server hot-replaces it: a newer ref for the store of its board. */
  live(r: BoardRef): void
  /** The session a live ref names, as a page reaches it; a fake in the tests. */
  transport(r: BoardRef): Transport | null
}
function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry>
  return (g[REGISTRY] ??= {
    refs: new Map(),
    sites: new WeakMap(),
    live(r) {
      const b = this.refs.get(refKey(r))
      if (b && r.run > (b.ref?.run ?? -1)) b.refresh(r)
    },
    transport: r => (r.session && typeof location !== 'undefined' ? sessionSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${r.session.path}`) : null),
  })
}

// the stores a session's stream follows: their facets, invalidates and heartbeat come on its socket, as a dev page's do
const following = new WeakSet<BoardStore>()
function follow(b: BoardStore, r: BoardRef) {
  const t = registry().transport(r)
  if (!t) return
  following.add(b)
  connectBoard(b, t)
}

/** The compile in the page of a ref that ships a module instead of facets, `pcbjs({ boards: 'compile' })`: the ref with its facets, or null with no compiler loaded. */
const compileOf = (r: BoardRef): Promise<BoardRef> | null =>
  (globalThis as unknown as Record<symbol, ((r: BoardRef) => Promise<BoardRef> | null) | undefined>)[Symbol.for('pcbjs.compile')]?.(r) ?? null

/** A ref's facets fetched from its URLs as views want them, once each per run, or from its compile in the page. */
function refLoader(b: BoardStore) {
  const asked = new Set<FacetName>()
  // the facets wanted while the page compiles the board
  let queued: Set<FacetName> | null = null
  const fail = (e: Error) => {
    b.error = e.message
    b.state = 'failed'
  }
  function want(list: readonly FacetName[]) {
    const r = b.ref
    if (!r || typeof fetch === 'undefined') return
    if (r.module && !Object.keys(r.facets).length) return compile(toRaw(r), list)
    for (const f of wanted(list)) {
      const url = r.facets[f]
      if (asked.has(f) || !url) continue
      asked.add(f)
      if (b.state === 'poster') b.state = 'loading'
      const run = r.run
      fetch(url)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(`${url}: ${res.status}`))))
        .then((data: Record<string, unknown>) => b.take({ board: b.name, ...(r.target ? { target: r.target } : {}), run, facet: f, stage: 'import', hash: facetHash(data), data }))
        .catch(fail)
    }
  }
  /** The first want of a board compiled in the page starts its compile; the poster stays until it lands, and for good when it fails. */
  function compile(r: BoardRef, list: readonly FacetName[]) {
    if (queued) return list.forEach(f => queued!.add(f))
    const run = compileOf(r)
    if (!run) return
    queued = new Set(list)
    b.state = 'loading'
    run.then(next => {
      b.ref = next
      b.run = next.run
      want([...queued!])
    }, fail)
  }
  /** A newer ref from the dev server: its facets come in its stream when one follows the board, else what was fetched is fetched again at its run. */
  function refresh(next: BoardRef) {
    b.ref = next
    b.run = next.run
    if (following.has(b)) return
    const again = [...asked]
    asked.clear()
    want(again)
  }
  return { want, refresh }
}

function fromRef(r: BoardRef): BoardStore {
  const b = createBoard(r.board)
  b.target = r.target
  b.ref = r
  b.run = r.run
  b.state = 'poster'
  b.load(refLoader(b))
  return b
}

function fromSite(site: SiteData): BoardStore {
  const b = createBoard(site.name)
  b.target = site.variant?.name ?? null
  b.takeSets([facetSet(site)], null)
  return b
}

/** The store of a board: one per site data object and per entry, board and target of a ref, made on first use. */
export function useBoard(input: BoardInput): BoardStore {
  if (isStore(input)) return input
  const reg = registry()
  if (isRef(input)) {
    const k = refKey(input)
    const had = reg.refs.get(k)
    if (!had) {
      const b = fromRef(input)
      reg.refs.set(k, b)
      follow(b, input)
      return b
    }
    if (had.ref && input.run > had.ref.run) had.refresh(input)
    return had
  }
  const had = reg.sites.get(input)
  if (had) return had
  const b = fromSite(input)
  reg.sites.set(input, b)
  return b
}

// the pane, preferences and command bus the components of a board on their own share
const own = new WeakMap<BoardStore, PaneContext>()
/** What the components of a board share outside a board page: one pane, light theme until a component's theme says otherwise. */
export function boardContext(board: BoardStore): PaneContext {
  let c = own.get(board)
  if (c) return c
  const pane = createPane('2d')
  const prefs: ViewPrefs = reactive({ grid: true, ratsnest: true, deep: false, theme: null })
  effectScope(true).run(() => paneEffects(board, pane))
  const say = (text: string, err = false) => (err ? console.warn(`pcbjs: ${text}`) : undefined)
  c = markRaw({
    board,
    pane,
    prefs,
    commands: markRaw(commandBus()),
    shell: null,
    theme: () => prefs.theme ?? 'light',
    toggle: (k: 'grid' | 'ratsnest') => (prefs[k] = !prefs[k]),
    say,
    open: async (t, quiet) => {
      if (board.site) await openTarget(board.site, t, say, quiet)
    },
  } satisfies PaneContext)
  own.set(board, c)
  return c
}

/** The context of the board page around this component, else of the board it was given, whose children then share it; `want` the facets it shows. */
export function usePane(input: BoardInput | undefined, want: readonly FacetName[]): PaneContext {
  const outer = injectPane()
  if (outer) return outer
  if (!input) throw new Error('pcbjs: a component outside a board page needs its board prop')
  const c = boardContext(useBoard(input))
  provide(PANE, c)
  onMounted(() => c.board.want(want))
  return c
}
