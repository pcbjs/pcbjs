// free of Vue and the DOM, written as erasable TypeScript so Node imports it in the tests
import type { FocusEvent, HoverWire, PagePost, ViewName } from '@pcbjs/core/protocol'
import type { Side } from './sides'

/** The theme kinds an editor reports; `hc` is a dark theme with higher contrast. */
export type IdeTheme = 'dark' | 'light' | 'hc'
/** `panel` false hides the right-hand panel, for an editor that shows findings, nets and BOM itself; `view` fixes the pane's view; `embed` is the bare view a page puts in an iframe, `tools` false hides its view's toolbars there */
export interface IdeQuery {
  ide: boolean
  theme: IdeTheme | null
  panel: boolean
  view: ViewName | null
  embed: boolean
  tools: boolean
}

const on = (v: string | null) => v === '1'
const off = (v: string | null) => v === '0'

/** Read `?ide=1&theme=dark|light|hc&panel=0&view=2d|3d|sch|checks&embed=1&tools=0` from a location's search string. `ide` and `embed` are on with 1, `panel` and `tools` off with 0. */
export function parseIdeQuery(search: string): IdeQuery {
  const q = new URLSearchParams(search)
  const ide = on(q.get('ide'))
  const t = q.get('theme')
  const theme = t === 'dark' || t === 'light' || t === 'hc' ? t : null
  const v3 = q.get('view')?.toLowerCase()
  const view = v3 === '2d' || v3 === '3d' || v3 === 'sch' || v3 === 'checks' ? v3 : null
  return { ide, theme, panel: !off(q.get('panel')), view, embed: on(q.get('embed')), tools: !off(q.get('tools')) }
}

/** The URL the viewer writes for a path: IDE and embed mode keep the page's query, so a reload stays in that mode. */
export const pageUrl = (path: string, mode: { ide: boolean; embed: boolean }, search: string): string => (mode.ide || mode.embed ? path + search : path)

/** What the editor or the embedding page posts into the page: pin a net, focus a finding by its exact id, switch the view or theme, draw a hover, select what a reference names; `board` switches first. */
export type IdeRequest = { target?: string | null; board?: string | null } & (
  | { kind: 'net'; board: string | null; net: string | null }
  | { kind: 'finding'; board: string | null; id: string }
  | { kind: 'view'; view: ViewName | null; side: Side | null; mirror: boolean | null }
  | { kind: 'theme'; theme: 'light' | 'dark' }
  | { kind: 'hover'; hover: HoverWire | null }
  | { kind: 'select'; refs: string[] | null; frame: boolean; by: 'tree' | 'viewer' }
)

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const FINDING = /^(drc|erc):[A-Za-z0-9_.-]+:[0-9a-f]{12}$/

/** A `message` event's data as an IdeRequest, null for anything else. */
export function parseIdeRequest(d: unknown): IdeRequest | null {
  if (!d || typeof d !== 'object') return null
  const m = d as Record<string, unknown>
  if ('target' in m && m.target !== null && typeof m.target !== 'string') return null
  const identity = { ...(typeof m.board === 'string' ? { board: m.board } : {}), ...('target' in m ? { target: m.target as string | null } : {}) }
  const board = typeof m.board === 'string' ? m.board : null
  if (m.type === 'pcbjs:net' && (typeof m.net === 'string' || m.net === null)) return { kind: 'net', board, ...identity, net: m.net }
  if (m.type === 'pcbjs:finding' && typeof m.id === 'string' && FINDING.test(m.id)) return { kind: 'finding', board, ...identity, id: m.id }
  if (m.type === 'pcbjs:view') {
    const view = m.view === '2d' || m.view === '3d' || m.view === 'sch' || m.view === 'checks' ? m.view : null
    const side = m.side === 'F' || m.side === 'B' ? m.side : null
    const mirror = typeof m.mirror === 'boolean' ? m.mirror : null
    return view || side || mirror !== null || Object.keys(identity).length ? { kind: 'view', ...identity, view, side, mirror } : null
  }
  if (m.type === 'pcbjs:theme' && (m.theme === 'light' || m.theme === 'dark')) return { kind: 'theme', theme: m.theme }
  if (m.type === 'pcbjs:hover' && strings(m.uids) && strings(m.refs) && (typeof m.net === 'string' || m.net == null)) {
    const net = m.net ?? null
    return { kind: 'hover', ...identity, hover: m.uids.length || m.refs.length || net ? { uids: [...m.uids], refs: [...m.refs], net } : null }
  }
  if (m.type === 'pcbjs:select' && (strings(m.refs) || m.refs === null))
    return { kind: 'select', ...identity, refs: m.refs?.length ? [...m.refs] : null, frame: m.frame === true, by: m.by === 'tree' ? 'tree' : 'viewer' }
  return null
}

/** The side on top and the mirror a view message carries. */
export interface EmbedLook {
  side: Side
  mirror: boolean
}

/**
 * When the frame posts ready and view: ready once the first view shown has painted, then a view each time a switch to it has painted.
 * `shown` names the view switched to, `painted` returns the message a paint posts, null for none; `look` gives the side and mirror of the moment.
 */
export function embedGate(board: string, views: ViewName[], look: () => EmbedLook = () => ({ side: 'F', mirror: false })) {
  let want: ViewName | null = null
  let ready = false
  return {
    shown(view: ViewName) {
      want = view
    },
    painted(view: ViewName): PagePost | null {
      if (view !== want) return null
      want = null
      if (ready) return { type: 'pcbjs:view', view, ...look() }
      ready = true
      return { type: 'pcbjs:ready', board, views }
    },
  }
}

/** The views a board has: 2D and 3D always, the schematic when it has a drawing. */
export const embedViews = (hasDrawing: boolean): ViewName[] => (hasDrawing ? ['2d', '3d', 'sch', 'checks'] : ['2d', '3d', 'checks'])

/** The hover message of a hover as it travels, plain arrays so a reactive one clones; null, the pointer leaving, is empty arrays and a null net. */
export const embedHover = (h: HoverWire | null): PagePost => ({ type: 'pcbjs:hover', uids: [...(h?.uids ?? [])], refs: [...(h?.refs ?? [])], net: h?.net ?? null })

/** A route as the path gives it, see routeFromPath in variants.ts. */
export type IdePathRoute = { page: 'home' } | { page: 'board'; name: string | null; target: string | null }

/** The route IDE mode shows for a path: never the home page, the focused board or else the first one. */
export function ideRoute(r: IdePathRoute, names: readonly string[], focused: string | null): { page: 'board'; name: string | null; target: string | null } {
  const fallback = focused != null && names.includes(focused) ? focused : (names[0] ?? null)
  if (r.page === 'home') return { page: 'board', name: fallback, target: null }
  if (r.name != null && names.includes(r.name)) return r
  return { page: 'board', name: names.length ? fallback : r.name, target: names.length ? null : r.target }
}

/** The board an editor focus switches to; null keeps the board when it imports the file or no board does. */
export function focusSwitch(current: string | null, e: FocusEvent, names: readonly string[]): string | null {
  if (!e.board || !names.includes(e.board)) return null
  if (current != null && (current === e.board || e.boards?.includes(current))) return null
  return e.board
}
