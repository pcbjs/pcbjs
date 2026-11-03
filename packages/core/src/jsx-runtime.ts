import type { Child, Component, IntrinsicElements as Intrinsics, PcbNode, Src } from './types.js'
import { callerSite, urlPath } from './provenance.js'
import { platform } from './platform.js'

export function h(type: string | Component, props: Record<string, any> | null, ...children: Child[]): PcbNode {
  const p = { ...(props ?? {}) }
  if (children.length) p.children = children.length === 1 ? children[0] : children
  return jsx(type, p)
}

/** The copper the helpers make, which has no element of its own. */
const HELPERS: Record<string, string> = { via: 'via(net, at, opts)', zone: 'pour(net, layer, area, opts)', keepout: 'keepout(area, opts)', stitch: 'stitch(net, opts)' }

export function jsx(type: string | Component, props: Record<string, any>, _key?: unknown): PcbNode {
  const { children, ...rest } = props ?? {}
  if (typeof type === 'string' && type in HELPERS) throw new TypeError(`<${type}> is no element; write ${HELPERS[type]}`)
  if (type === 'track' && !Array.isArray(rest.points)) throw new TypeError("<track> takes points, the raw polyline; draw copper with route(), such as route('3 10').net(VCC).H(9)")
  const kids: Child[] = children === undefined ? [] : Array.isArray(children) ? children : [children]
  // model and font files are relative to the file that wrote them; a <footprint> with a source range is anchored by the compiler
  if (rest.model && !(type === 'footprint' && rest.__src?.file) && needsAnchor(rest.model)) rest.model = anchorModel(rest.model, callerSite()?.file)
  if (rest.fonts && typeof rest.fonts === 'object' && Object.values(rest.fonts).some(needsFontPath)) rest.fonts = anchorFonts(rest.fonts, callerSite()?.file)
  return { $$: 'pcb', type, props: rest, children: kids }
}

const ANCHORED = Symbol.for('pcbjs.model.anchored')

/** True for a model file spec with a relative path that no file has claimed yet; a fetched source, `kicad:`, `lcsc:`, a URL or a KiCad variable, is no path. */
function needsAnchor(m: unknown): boolean {
  if (!m || typeof m !== 'object' || (m as any)[ANCHORED]) return false
  const f = (m as any).file
  return (
    (m as any).kind === undefined &&
    typeof f === 'string' &&
    !!f.trim() &&
    !f.startsWith('file:') &&
    !/^([\\/]|[A-Za-z]:[\\/])/.test(f) &&
    !/^(kicad:|lcsc:|https?:\/\/|\$\{)/i.test(f)
  )
}

/** A model spec anchored like an import: `file` keeps the path as written, `path` is the absolute path; anything else unchanged. */
export function anchorModel<T>(m: T, file: string | undefined): T {
  if (!file || !needsAnchor(m)) return m
  const path = platform().path
  if (!path.isAbsolute(file)) return m
  const f = (m as any).file as string
  return { ...m, path: path.resolve(path.dirname(file), f), [ANCHORED]: true }
}
export const jsxs = jsx

/** True for a font entry, `{ file }`, whose absolute path is not known yet. */
function needsFontPath(f: unknown): boolean {
  return !!f && typeof f === 'object' && typeof (f as any).file === 'string' && typeof (f as any).path !== 'string'
}
/** A font entry as `{ file, path }` with `path` resolved against the writing file, in Node. */
export function anchorFont<T>(f: T, file: string | undefined): T | { file: string; path: string } {
  if (!file || !needsFontPath(f)) return f
  const path = platform().path
  if (!path.isAbsolute(file)) return f
  const o = f as any
  const p = o.file.startsWith('file:') ? urlPath(o.file) : path.resolve(path.dirname(file), o.file)
  return { ...o, path: p }
}
/** A `fonts` map with every entry anchored, see anchorFont. */
export function anchorFonts(fonts: Record<string, unknown>, file: string | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fonts).map(([k, v]) => [k, anchorFont(v, file)]))
}

export function Fragment(props: { children?: Child }): Child {
  return props.children ?? null
}

export function withSrc(node: PcbNode, src: Src | undefined): PcbNode {
  if (src) node.src = src
  return node
}

export function isNode(v: unknown): v is PcbNode {
  return typeof v === 'object' && v !== null && (v as PcbNode).$$ === 'pcb'
}

// shared by every module copy: the CLI's compiles what Vite's created
const READ: WeakMap<object, unknown[]> = ((globalThis as any)[Symbol.for('pcbjs.children.read')] ??= new WeakMap())

/** A list child as an array, an iterator read once so every variant compile sees the same items; null when not a list. */
export function childList(c: unknown): readonly unknown[] | null {
  if (Array.isArray(c)) return c
  if (c === null || typeof c !== 'object' || isNode(c) || typeof (c as any)[Symbol.iterator] !== 'function') return null
  if (typeof (c as any).next !== 'function') return [...(c as Iterable<unknown>)]
  let got = READ.get(c)
  if (!got) {
    got = [...(c as Iterable<unknown>)]
    READ.set(c, got)
  }
  return got
}

export namespace JSX {
  export type Element = PcbNode
  export interface IntrinsicElements extends Intrinsics {}
  export interface ElementChildrenAttribute {
    children: {}
  }
  /** accepted on every element for list rendering; pcbjs ignores it */
  export interface IntrinsicAttributes {
    key?: string | number
  }
}
