// free of Vue and the DOM, written as erasable TypeScript so Node imports it in the tests
import type { HoverTarget } from './sync'

/** The theme kinds an editor reports; `hc` is a dark theme with higher contrast. */
export type IdeTheme = 'dark' | 'light' | 'hc'
export type IdeView = '2d' | '3d' | 'sch'
/** `panel` false hides the right-hand panel, for an editor that shows findings, nets and BOM itself; `view` fixes the pane's view; `embed` is the bare view a page puts in an iframe, `tools` false hides its view's toolbars there */
export interface IdeQuery {
  ide: boolean
  theme: IdeTheme | null
  panel: boolean
  view: IdeView | null
  embed: boolean
  tools: boolean
}

const flag = (v: string | null) => v !== null && ['', '1', 'true', 'yes'].includes(v.toLowerCase())
const off = (v: string | null) => v !== null && ['0', 'false', 'no'].includes(v.toLowerCase())

/** Read `?ide=1&theme=dark|light|hc&panel=0&view=2d|3d|sch&embed=1&tools=0` from a location's search string. `ide` and `embed` take 1, true, yes or an empty value; `tools` 0, false or no hides the toolbars. */
export function parseIdeQuery(search: string): IdeQuery {
  const q = new URLSearchParams(search)
  const ide = flag(q.get('ide'))
  const t = q.get('theme')?.toLowerCase()
  const theme = t === 'dark' || t === 'light' ? t : t === 'hc' || t === 'high-contrast' || t === 'hc-dark' ? 'hc' : t === 'hc-light' ? 'light' : null
  const v3 = q.get('view')?.toLowerCase()
  const view = v3 === '2d' || v3 === '3d' || v3 === 'sch' ? v3 : null
  return { ide, theme, panel: !off(q.get('panel')), view, embed: flag(q.get('embed')), tools: !off(q.get('tools')) }
}

/** The URL the viewer writes for a path: IDE and embed mode keep the page's query, so a reload stays in that mode. */
export const pageUrl = (path: string, mode: { ide: boolean; embed: boolean }, search: string): string => (mode.ide || mode.embed ? path + search : path)

/** What the editor or the embedding page posts into the page: pin a net, pan to a finding, switch the view or theme, draw a hover, select a part; `board` switches first. */
export type IdeRequest =
  | { kind: 'net'; board: string | null; net: string | null }
  | { kind: 'finding'; board: string | null; at: [number, number]; layer: string | null }
  | { kind: 'view'; view: IdeView }
  | { kind: 'theme'; theme: 'light' | 'dark' }
  | { kind: 'hover'; hover: HoverTarget | null }
  | { kind: 'select'; ref: string | null; frame: boolean }

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const ints = (v: unknown): v is number[] => Array.isArray(v) && v.every(Number.isInteger)

/** A `message` event's data as an IdeRequest, null for anything else. */
export function parseIdeRequest(d: unknown): IdeRequest | null {
  if (!d || typeof d !== 'object') return null
  const m = d as Record<string, unknown>
  const board = typeof m.board === 'string' ? m.board : null
  if (m.type === 'pcbjs:net' && (typeof m.net === 'string' || m.net === null)) return { kind: 'net', board, net: m.net }
  const at = m.at
  if (m.type === 'pcbjs:finding' && Array.isArray(at) && at.length === 2 && at.every(Number.isFinite))
    return { kind: 'finding', board, at: [at[0], at[1]], layer: typeof m.layer === 'string' ? m.layer : null }
  if (m.type === 'pcbjs:view' && (m.view === '2d' || m.view === '3d' || m.view === 'sch')) return { kind: 'view', view: m.view }
  if (m.type === 'pcbjs:theme' && (m.theme === 'light' || m.theme === 'dark')) return { kind: 'theme', theme: m.theme }
  if (m.type === 'pcbjs:hover' && ints(m.ids) && strings(m.refs) && (typeof m.net === 'string' || m.net == null)) {
    const net = m.net ?? null
    return { kind: 'hover', hover: m.ids.length || m.refs.length || net ? { ids: [...m.ids], refs: [...m.refs], net } : null }
  }
  if (m.type === 'pcbjs:select' && (typeof m.ref === 'string' || m.ref === null)) return { kind: 'select', ref: m.ref || null, frame: m.frame === true }
  return null
}

/** What an embedded page posts to the page around it. */
export type EmbedMessage =
  | { type: 'pcbjs:ready'; board: string; views: IdeView[] }
  | { type: 'pcbjs:hover'; ids: number[]; refs: string[]; net: string | null }
  | { type: 'pcbjs:select'; ref: string | null }
  | { type: 'pcbjs:view'; view: IdeView }

/**
 * When the frame posts ready and view: ready once the first view shown has painted, then a view each time a switch to it has painted.
 * `shown` names the view switched to, `painted` returns the message a paint posts, null for none.
 */
export function embedGate(board: string, views: IdeView[]) {
  let want: IdeView | null = null
  let ready = false
  return {
    shown(view: IdeView) {
      want = view
    },
    painted(view: IdeView): EmbedMessage | null {
      if (view !== want) return null
      want = null
      if (ready) return { type: 'pcbjs:view', view }
      ready = true
      return { type: 'pcbjs:ready', board, views }
    },
  }
}

/** The views a board has: 2D and 3D always, the schematic when it has a drawing. */
export const embedViews = (hasDrawing: boolean): IdeView[] => (hasDrawing ? ['2d', '3d', 'sch'] : ['2d', '3d'])

/** The hover message of a hover target, plain arrays so a reactive one clones; null, the pointer leaving, is empty arrays and a null net. */
export const embedHover = (h: HoverTarget | null): EmbedMessage => ({ type: 'pcbjs:hover', ids: [...(h?.ids ?? [])], refs: [...(h?.refs ?? [])], net: h?.net ?? null })

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
