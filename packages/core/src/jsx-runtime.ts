import type { Child, Component, IntrinsicElements as Intrinsics, PcbNode, Src } from './types.js'
import { callerSite } from './schematic.js'

export function h(type: string | Component, props: Record<string, any> | null, ...children: Child[]): PcbNode {
  const p = { ...(props ?? {}) }
  if (children.length) p.children = children.length === 1 ? children[0] : children
  return jsx(type, p)
}

export function jsx(type: string | Component, props: Record<string, any>, _key?: unknown): PcbNode {
  const { children, ...rest } = props ?? {}
  const kids: Child[] = children === undefined ? [] : Array.isArray(children) ? children : [children]
  // model and font files are relative to the file that wrote them; a <footprint> with a source range is anchored by the compiler
  if (rest.model && !(type === 'footprint' && rest.__src?.file) && needsAnchor(rest.model)) rest.model = anchorModel(rest.model, callerSite(true)?.file)
  if (type === 'footprint' && rest.model) rest.model = modelFileSpec(rest.model)
  if (rest.fonts && typeof rest.fonts === 'object' && Object.values(rest.fonts).some(needsFontPath)) rest.fonts = anchorFonts(rest.fonts, callerSite(true)?.file)
  if (type === 'text' && needsFontPath(rest.font)) rest.font = anchorFont(rest.font, callerSite(true)?.file)
  return { $$: 'pcb', type, props: rest, children: kids }
}

const ANCHORED = Symbol.for('pcbjs.model.anchored')

/** Node's path module when running in Node, null in a browser, where model files are not resolved. */
function nodePath(): typeof import('node:path') | null {
  const p = (globalThis as any).process
  if (!p || typeof p.getBuiltinModule !== 'function') return null
  try { return p.getBuiltinModule('node:path') } catch { return null }
}

/** True for a model file spec with a relative path that no file has claimed yet; a fetched source, `kicad:`, `lcsc:`, a URL or a KiCad variable, is no path. */
function needsAnchor(m: unknown): boolean {
  if (!m || typeof m !== 'object' || (m as any)[ANCHORED]) return false
  const k = (m as any).kind, f = (m as any).file ?? (m as any).step
  return (k === undefined || k === 'step') && typeof f === 'string' && !!f.trim() && !f.startsWith('file:') && !/^([\\/]|[A-Za-z]:[\\/])/.test(f) && !/^(kicad:|lcsc:|https?:\/\/|\$\{)/i.test(f)
}

/** A model spec anchored like an import: `file` keeps the path as written, `step` the absolute path; anything else unchanged. */
export function anchorModel<T>(m: T, file: string | undefined): T {
  if (!file || !needsAnchor(m)) return m
  const path = nodePath()
  if (!path || !path.isAbsolute(file)) return m
  const f = ((m as any).file ?? (m as any).step) as string
  return { ...m, file: f, step: path.resolve(path.dirname(file), f), [ANCHORED]: true }
}
export const jsxs = jsx

/** True for a font entry, a path or `{ file }`, whose absolute path is not known yet. */
function needsFontPath(f: unknown): boolean {
  if (typeof f === 'string') return /\.(ttf|otf|ttc)$/i.test(f)
  return !!f && typeof f === 'object' && typeof (f as any).file === 'string' && typeof (f as any).path !== 'string'
}
/** A font entry as `{ file, path }` with `path` resolved against the writing file, in Node. */
export function anchorFont<T>(f: T, file: string | undefined): T | { file: string; path: string } {
  if (!file || !needsFontPath(f)) return f
  const path = nodePath()
  if (!path || !path.isAbsolute(file)) return f
  const o = typeof f === 'string' ? { file: f } : (f as any)
  const p = o.file.startsWith('file:') ? decodeURIComponent(new URL(o.file).pathname) : path.resolve(path.dirname(file), o.file)
  return { ...o, path: p }
}
/** A `fonts` map with every entry anchored, see anchorFont. */
export function anchorFonts(fonts: Record<string, unknown>, file: string | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fonts).map(([k, v]) => [k, anchorFont(v, file)]))
}

/** A model spec with `file` given and `step` not, completed with `step` as the compiler reads it; any other value as it is. */
export function modelFileSpec<T>(m: T): T {
  if (m && typeof m === 'object' && typeof (m as any).file === 'string' && (m as any).step === undefined && ((m as any).kind === undefined || (m as any).kind === 'step'))
    return { ...m, step: (m as any).file }
  return m
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
  if (!got) { got = [...(c as Iterable<unknown>)]; READ.set(c, got) }
  return got
}

export namespace JSX {
  export type Element = PcbNode
  export interface IntrinsicElements extends Intrinsics {}
  export interface ElementChildrenAttribute { children: {} }
  /** accepted on every element for list rendering; pcbjs ignores it */
  export interface IntrinsicAttributes { key?: string | number }
}
