// free of Vue and the DOM, written as erasable TypeScript so Node imports it in the tests

/** The theme kinds an editor reports; `hc` is a dark theme with higher contrast. */
export type IdeTheme = 'dark' | 'light' | 'hc'
export type IdeView = '2d' | '3d' | 'sch'
/** `panel` false hides the right-hand panel, for an editor that shows findings, nets and BOM itself; `view` fixes the pane's view */
export interface IdeQuery {
  ide: boolean
  theme: IdeTheme | null
  panel: boolean
  view: IdeView | null
}

/** Read `?ide=1&theme=dark|light|hc&panel=0&view=2d|3d|sch` from a location's search string. `ide` takes 1, true, yes or an empty value. */
export function parseIdeQuery(search: string): IdeQuery {
  const q = new URLSearchParams(search)
  const v = q.get('ide')
  const ide = v !== null && ['', '1', 'true', 'yes'].includes(v.toLowerCase())
  const t = q.get('theme')?.toLowerCase()
  const theme = t === 'dark' || t === 'light' ? t : t === 'hc' || t === 'high-contrast' || t === 'hc-dark' ? 'hc' : t === 'hc-light' ? 'light' : null
  const p = q.get('panel')?.toLowerCase()
  const v3 = q.get('view')?.toLowerCase()
  const view = v3 === '2d' || v3 === '3d' || v3 === 'sch' ? v3 : null
  return { ide, theme, panel: !(p === '0' || p === 'false' || p === 'no'), view }
}

/** What the editor posts into the page: pin a net, or pan to a finding; `board` switches first. */
export type IdeRequest = { kind: 'net'; board: string | null; net: string | null } | { kind: 'finding'; board: string | null; at: [number, number]; layer: string | null }

/** A `message` event's data as an IdeRequest, null for anything else. */
export function parseIdeRequest(d: unknown): IdeRequest | null {
  if (!d || typeof d !== 'object') return null
  const m = d as Record<string, unknown>
  const board = typeof m.board === 'string' ? m.board : null
  if (m.type === 'pcbjs:net' && (typeof m.net === 'string' || m.net === null)) return { kind: 'net', board, net: m.net }
  const at = m.at
  if (m.type === 'pcbjs:finding' && Array.isArray(at) && at.length === 2 && at.every(Number.isFinite))
    return { kind: 'finding', board, at: [at[0], at[1]], layer: typeof m.layer === 'string' ? m.layer : null }
  return null
}

/** A route as the path gives it, see routeFromPath in variants.ts. */
export type IdePathRoute = { page: 'home' } | { page: 'board'; name: string | null; target: string | null }

/** The route IDE mode shows for a path: never the home page, the focused board or else the first one. */
export function ideRoute(r: IdePathRoute, names: readonly string[], focused: string | null): { page: 'board'; name: string | null; target: string | null } {
  const fallback = focused != null && names.includes(focused) ? focused : (names[0] ?? null)
  if (r.page === 'home') return { page: 'board', name: fallback, target: null }
  if (r.name != null && names.includes(r.name)) return r
  return { page: 'board', name: names.length ? fallback : r.name, target: names.length ? null : r.target }
}

/** `pcbjs:focus` resolved: `boards` import the file; `isolated` is the preview of a file no board imports, named `preview:<file>`. */
export interface FocusEvent {
  board: string | null
  entry: string | null
  file: string
  boards?: string[]
  isolated?: boolean
  scope?: string
}

/** The board an editor focus switches to; null keeps the board when it imports the file or no board does. */
export function focusSwitch(current: string | null, e: FocusEvent, names: readonly string[]): string | null {
  if (!e.board || !names.includes(e.board)) return null
  if (current != null && (current === e.board || e.boards?.includes(current))) return null
  return e.board
}
