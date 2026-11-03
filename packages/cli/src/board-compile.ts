// The page half of `pcbjs({ boards: 'compile' })`: a `?pcb:board` module that ships no facet files compiles its board in the page's
// compile worker when a view first shows it, and hands its sources the facets as blob URLs, as a dev server hands a newer ref. docs/ui.md.
import { compileInBrowser, type BrowserModule, type WorkerPort } from '@pcbjs/compile/browser'
import type { BoardRef, FacetName, FacetOut } from '@pcbjs/core/site-facets'

/** What the browser compile makes; the fab facet needs the exports stage, which runs in Node only. */
const WANT: FacetName[] = ['meta', 'sch', 'layers', 'model', 'findings']

// one worker per project, so the registries of two projects never meet in one realm
const WORKERS = new Map<string, () => WorkerPort>()

/** Every URL of a module made absolute against the page, as the worker fetches and imports from its own location. */
export function absoluteModule(m: BrowserModule, base: string): BrowserModule {
  const abs = (u: string) => new URL(u, base).href
  const map = <T extends string | null>(r: Record<string, T> | undefined) =>
    r && (Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? null : abs(v)])) as Record<string, T>)
  return {
    ...m,
    ...(m.config ? { config: abs(m.config) } : {}),
    module: abs(m.module),
    ...(m.patches ? { patches: abs(m.patches) } : {}),
    ...(m.modules ? { modules: m.modules.map(abs) } : {}),
    ...(m.files ? { files: map(m.files) } : {}),
    ...(m.routes ? { routes: map(m.routes) } : {}),
    ...(m.references ? { references: map(m.references) } : {}),
  }
}

/** The facets of one target: the one the ref names, else the first the compile made. */
export function targetFacets(ref: Pick<BoardRef, 'board' | 'target'>, facets: FacetOut[]): Map<FacetName, FacetOut> {
  const mine = facets.filter(f => f.board === ref.board)
  const target = ref.target ?? mine[0]?.target
  const out = new Map<FacetName, FacetOut>()
  for (const f of mine) if (f.target === target || (!f.target && !target)) out.set(f.facet, f)
  return out
}

/** The hook @pcbjs/ui's sources call on the first view of a board that has a module and no facets yet. */
const HOOK = Symbol.for('pcbjs.compile')

const keyOf = (r: Pick<BoardRef, 'entry' | 'board' | 'target'>) => `${r.entry}\0${r.board}\0${r.target ?? ''}`

// the boards of the page by ref key: their worker URL and, once a view asked, the compile
const BOARDS = new Map<string, { ref: BoardRef; worker: string; run?: Promise<BoardRef> }>()

/** Makes the board of `ref` compile in a worker of `workerUrl` when a view first wants its facets; a no-op outside a browser. */
export function compileBoard(ref: BoardRef, workerUrl: string): void {
  if (typeof window === 'undefined' || !ref.module) return
  BOARDS.set(keyOf(ref), { ref, worker: workerUrl })
  const g = globalThis as unknown as Record<symbol, (r: BoardRef) => Promise<BoardRef> | null>
  g[HOOK] ??= start
}

/** The compile of a registered board, started once: the ref with the facets as blob URLs, rejected when the browser cannot compile it. */
function start(r: Pick<BoardRef, 'entry' | 'board' | 'target'>): Promise<BoardRef> | null {
  const b = BOARDS.get(keyOf(r))
  if (!b) return null
  b.run ??= run(b.ref, b.worker).catch((e: Error) => {
    console.warn(`pcbjs: the browser compile of ${b.ref.board} failed: ${e.message}`)
    throw e
  })
  return b.run
}

async function run(ref: BoardRef, workerUrl: string): Promise<BoardRef> {
  if (typeof Worker === 'undefined') throw new Error('this browser runs no workers')
  const base = document.baseURI
  const res = await fetch(new URL(ref.module!, base))
  if (!res.ok) throw new Error(`${ref.module}: HTTP ${res.status}`)
  const m = (await res.json()) as BrowserModule
  const key = m.config ?? m.module
  let make = WORKERS.get(key)
  if (!make) WORKERS.set(key, (make = () => new Worker(new URL(workerUrl, base), { type: 'module' }) as unknown as WorkerPort))
  const r = await compileInBrowser(absoluteModule(m, base), { worker: make, want: WANT })
  const facets = Object.fromEntries(
    [...targetFacets(ref, r.facets)].map(([name, f]) => [name, URL.createObjectURL(new Blob([JSON.stringify(f.data)], { type: 'application/json' }))]),
  )
  if (!facets.meta) throw new Error(`the compile made no board ${ref.board}`)
  return { ...ref, facets, run: ref.run + 1 }
}
