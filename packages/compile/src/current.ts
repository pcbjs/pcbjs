// DRC `current-width`, see routing.md: the widths of a route with `.current()` against the IPC-2152 baseline chart for the copper it runs on.
import type { AutoRouteJob, Board, DrcMarker } from '@pcbjs/core/model'
import { marker } from './messages.js'

/** The temperature rise the check sizes for, °C. */
export const RISE = 10
const MIL2 = 0.0254 * 0.0254
const OZ = 0.035

/** The width in mm a current in amps needs on copper `t` mm thick: the IPC-2152 baseline chart fitted as A = (117.555 dT^-0.913 + 1.15) I^(0.84 dT^-0.018 + 1.159) mil². */
export function ipc2152Width(amps: number, t: number, rise = RISE): number {
  const area = (117.555 * Math.pow(rise, -0.913) + 1.15) * Math.pow(amps, 0.84 * Math.pow(rise, -0.018) + 1.159)
  return (area * MIL2) / t
}

/** One finding per width of a route or branch narrower than the current it carries needs: its own, or the sum of its branches when more. */
export function currentFindings(board: Board, jobs: readonly AutoRouteJob[]): DrcMarker[] {
  const out: DrcMarker[] = []
  for (const own of byRoute(jobs).values()) {
    if (!own.some(j => j.current !== undefined)) continue
    const thin = thinnest(board, own[0].route)
    if (!thin) continue
    const trunk = own[0].current ?? 0
    const forkOf = new Map(own.flatMap(j => (j.fork !== undefined ? [[j.fork, j] as const] : [])))
    // an extra end shares the route's current, a branch carries its own
    const self = (j: AutoRouteJob) => j.current ?? (j.fork === undefined ? trunk : 0)
    const from = (j: AutoRouteJob, i: number): number =>
      Math.max(
        self(j),
        (j.steps ?? []).slice(i).reduce((s, st) => s + (st.op === 'B' && forkOf.has(st.id) ? from(forkOf.get(st.id)!, 0) : 0), 0),
      )
    for (const j of own) for (const w of widthsOf(board, j, from)) check(out, board, j, w, thin)
  }
  return out
}

/** Each width the job declares, with the current it carries from there on: its own, or its later branches' when more. */
function widthsOf(board: Board, j: AutoRouteJob, from: (j: AutoRouteJob, i: number) => number): { width: number; amps: number }[] {
  const out = [{ width: j.width ?? board.rules.minTrackWidth, amps: from(j, 0) }]
  ;(j.steps ?? []).forEach((st, i) => {
    if (st.op === 'W') out.push({ width: st.width, amps: from(j, i + 1) })
  })
  return out.filter(w => w.amps > 0)
}

function byRoute(jobs: readonly AutoRouteJob[]): Map<string, AutoRouteJob[]> {
  const out = new Map<string, AutoRouteJob[]>()
  for (const j of jobs) if (j.route) out.set(j.route, [...(out.get(j.route) ?? []), j])
  return out
}

/** The thinnest copper the route's tracks run on, else its starting layer's; null without a stackup. */
function thinnest(board: Board, route: string | undefined): { layer: string; t: number } | null {
  const cu = (board.stackup?.layers ?? []).filter(l => l.type === 'copper')
  if (!cu.length) return null
  const used = new Set(board.items.flatMap(it => (it.kind === 'track' && it.route === route ? [it.layer] : [])))
  const on = cu.filter(l => used.has(l.name))
  const list = on.length ? on : cu.slice(0, 1)
  const l = list.reduce((a, b) => (b.thickness < a.thickness ? b : a))
  return { layer: l.name, t: l.thickness }
}

function check(out: DrcMarker[], board: Board, j: AutoRouteJob, w: { width: number; amps: number }, cu: { layer: string; t: number }): void {
  const need = ipc2152Width(w.amps, cu.t)
  if (w.width >= need - 1e-6) return
  const start = board.items.find(it => it.kind === 'track' && it.route === j.route)
  out.push(
    marker({
      severity: 'error',
      rule: 'current-width',
      args: { route: j.route ?? '', amps: w.amps, oz: Math.round((cu.t / OZ) * 10) / 10, rise: RISE, layer: cu.layer },
      measured: { value: w.width, unit: 'mm' },
      required: { value: Math.round(need * 1000) / 1000, unit: 'mm' },
      refs: j.route ? [j.route] : [],
      at: start && start.kind === 'track' ? start.pts[0] : [0, 0],
      ...(j.net !== undefined ? { net: j.net } : {}),
      ...(j.src ? { src: j.src } : {}),
    }),
  )
}
