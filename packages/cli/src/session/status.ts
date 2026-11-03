// `pcbjs:status` as a projection of the compile stream, docs/viewer.md: the run each event belongs to, its stages and the router's legs.
import type { CompileEvent, LoadStatus, StageState } from '@pcbjs/core/protocol'

/** ms between two sends of the same stage's progress at most */
export const PROGRESS_MS = 100

/** The status after an event and whether it must go out at once: a run began, ended, or a stage changed state. */
export function nextStatus(st: LoadStatus, e: CompileEvent): { status: LoadStatus; moved: boolean } | null {
  const stages = 'stages' in st && st.stages ? st.stages : []
  switch (e.t) {
    case 'started':
      return {
        status: { phase: 'compiling', entry: e.entry, name: e.name, done: e.done, total: e.total, run: e.run, stages: e.stages.map(name => ({ name, state: 'stale', ms: 0 })) },
        moved: true,
      }
    case 'stage':
      return st.phase === 'compiling' || st.phase === 'routing' ? stageOf(st, e) : null
    case 'cancelled':
      return { status: { phase: 'cancelled', run: e.run, stages }, moved: true }
    case 'committed':
      return { status: { phase: 'idle', run: e.run, stages }, moved: true }
    default:
      return null
  }
}

function stageOf(st: Extract<LoadStatus, { phase: 'compiling' | 'routing' }>, e: Extract<CompileEvent, { t: 'stage' }>): { status: LoadStatus; moved: boolean } {
  const stages: StageState[] = st.stages.map(g => (g.name === e.stage ? { ...g } : g))
  const g = stages.find(x => x.name === e.stage)
  const moved = !!g && g.state !== e.state
  if (g) {
    g.state = e.state
    g.ms += e.ms
    if (e.units) g.units = e.units
    if (e.state === 'done' && g.units) g.units = [g.units[1], g.units[1]]
  }
  const base = { entry: st.entry, name: st.name, done: st.done, total: st.total, run: st.run, stages }
  if (e.stage === 'autoroute' && e.state === 'running' && e.units)
    return { status: { ...base, phase: 'routing', routed: e.units[0], legs: e.units[1], ...(e.round ? { round: e.round } : {}) }, moved: moved || e.units[0] === e.units[1] }
  // the legs stay until another stage runs
  const routing = st.phase === 'routing' && (e.stage === 'autoroute' || e.state !== 'running')
  return { status: routing ? { ...st, stages } : { ...base, phase: 'compiling' }, moved }
}
