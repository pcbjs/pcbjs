import type { Child } from '@pcbjs/core/types'
import PCB from '@pcbjs/core'
import { h, isNode } from '@pcbjs/core/jsx-runtime'
import { isPart, nets } from '@pcbjs/core/schematic'
import { isCircuit, isCircuitInstance } from '@pcbjs/core/circuit'

/** The prefix of every transient board name. */
export const PREVIEW_PREFIX = 'preview:'
/** The name of the transient board of a file, `preview:<path relative to the root>`. */
export const previewName = (rel: string): string => PREVIEW_PREFIX + rel
/** True for the name of a transient board. */
export const isPreviewName = (name: string): boolean => name.startsWith(PREVIEW_PREFIX)
/** Where a transient board's files are served in dev: `/__pcbjs/preview/<encoded rel>`. */
export const previewDir = (rel: string): string => `/__pcbjs/preview/${encodeURIComponent(rel)}`
/** The path a transient board's files are asked for under /__pcbjs/, split into the file's rel path and the file asked for, null for any other path. */
export function previewRoute(path: string): { rel: string; file: string } | null {
  const m = /^preview\/([^/]+)\/(.+)$/.exec(path)
  if (!m) return null
  try {
    return { rel: decodeURIComponent(m[1]), file: decodeURIComponent(m[2]) }
  } catch {
    return null
  }
}

/** What a default export is, for the preview. */
export type PreviewKind = 'board' | 'part' | 'instance' | 'layout'

/** A layout component: a function with the name of the circuit it lays out, which neither a part nor a circuit definition is. */
const isLayout = (v: unknown): v is ((props: Record<string, unknown>) => Child) & { circuit: string } =>
  typeof v === 'function' && typeof (v as any).circuit === 'string' && !isPart(v) && !isCircuit(v)

const FIXED = new Set(['$$', 'name', 'circuit', 'path', 'ports', 'nets'])
/** The parts of a circuit instance in key order, those of nested instances in place. */
function partsOf(inst: any, out: unknown[] = []): unknown[] {
  for (const [k, v] of Object.entries(inst)) {
    if (FIXED.has(k)) continue
    if (isPart(v)) out.push(v)
    else if (isCircuitInstance(v)) partsOf(v, out)
  }
  return out
}

/** The pitch of the row an instance without a layout is placed in, mm. */
export const ROW_PITCH = 3

/** An instance of a circuit with a fresh net per port, found by calling it until no missing port throws. */
export function instantiate(def: any): unknown {
  const ports: Record<string, unknown> = {}
  const pool = nets()
  for (let i = 0; i < 64; i++) {
    try {
      return def(ports)
    } catch (e: any) {
      const m = /the port (\w+) is not connected/.exec(String(e?.message ?? ''))
      if (!m || m[1] in ports) throw e
      ports[m[1]] = pool[m[1]]
    }
  }
  throw new Error(`${def.name}: too many ports`)
}

/** The root to compile for a module's default export, null for nothing; `related` holds the circuit of a default-exported layout. */
export function previewRoot(exports: Record<string, unknown>, related: Record<string, unknown>[] = []): { root: Child; kind: PreviewKind; wrapped: boolean } | null {
  const d: unknown = exports.default
  if (d === undefined || d === null) return null
  if (isNode(d)) return { root: d as Child, kind: 'board', wrapped: false }
  const wrap = (child: Child) => h(PCB as any, { name: 'Preview' }, child)
  if (isPart(d)) return { root: wrap(h(d as any, { at: '0 0' })), kind: 'part', wrapped: true }
  if (isCircuitInstance(d)) {
    const inst = d as any
    const own = Object.values(exports).find(v => isLayout(v) && v.circuit === inst.circuit) as any
    if (own) return { root: wrap(h(own, { g: inst, at: '0 0' })), kind: 'instance', wrapped: true }
    const parts = partsOf(inst)
    if (!parts.length) return null
    return { root: wrap(h('g', {}, ...parts.map((p, i) => h(p as any, { at: `${i * ROW_PITCH} 0` })))), kind: 'instance', wrapped: true }
  }
  if (isLayout(d)) {
    const lay = d as any
    for (const scope of [exports, ...related]) {
      for (const v of Object.values(scope)) {
        if (isCircuit(v) && (v as any).name === lay.circuit) return { root: wrap(h(lay, { g: instantiate(v), at: '0 0' })), kind: 'layout', wrapped: true }
        if (isCircuitInstance(v) && (v as any).circuit === lay.circuit) return { root: wrap(h(lay, { g: v, at: '0 0' })), kind: 'layout', wrapped: true }
      }
    }
    return null
  }
  return null
}

/** The same wrapped root with a rectangular Edge.Cuts outline `margin` mm around `bbox`, so the preview has a board to sit on. */
export function withOutline(root: Child, bbox: { x: number; y: number; w: number; h: number }, margin = 2): Child {
  const node = root as any
  const x0 = +(bbox.x - margin).toFixed(3),
    y0 = +(bbox.y - margin).toFixed(3)
  const x1 = +(bbox.x + bbox.w + margin).toFixed(3),
    y1 = +(bbox.y + bbox.h + margin).toFixed(3)
  const edge = h('path', { layer: 'Edge.Cuts', d: `M ${x0} ${y0} H ${x1} V ${y1} H ${x0} Z` })
  return { ...node, children: [...node.children, edge] }
}
