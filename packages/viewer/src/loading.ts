// the dev server's loading state, free of Vue and the DOM so Node imports it in the tests

/** `pcbjs:status` as the dev server sends it, see LoadStatus in the CLI's plugin. */
export type Compile = { phase: 'compiling' | 'routing'; entry: string; name: string | null; done: number; total: number; routed?: number; legs?: number; round?: number }
export type ServerStatus = { phase: 'starting' | 'idle' } | Compile

/** starting: no word from the server yet; compiling: a compile runs; rendering: the board is in, the view draws; empty: the server answered with no board to show; gone: the server stopped. */
export type Phase = 'starting' | 'compiling' | 'rendering' | 'ready' | 'empty' | 'gone'

export interface Load {
  phase: Phase
  status: Compile | null
  /** a board has drawn once: from then on a compile keeps it on show */
  shown: boolean
  /** reconnection attempts since the server went */
  attempts: number
}

export type LoadEvent = { kind: 'status'; status: ServerStatus } | { kind: 'drawn' } | { kind: 'lost' } | { kind: 'retry' } | { kind: 'boards'; count: number }

/** What the page inlines: the project, where to start the server, and the status when the page was served. */
export interface Boot {
  project: string
  root: string
  devJson: string
  command: string
  status?: ServerStatus
}

export function initialLoad(status?: ServerStatus | null): Load {
  return step({ phase: 'starting', status: null, shown: false, attempts: 0 }, status ? { kind: 'status', status } : null)
}

export function step(s: Load, e: LoadEvent | null): Load {
  if (!e) return s
  if (s.phase === 'gone') return e.kind === 'retry' ? { ...s, attempts: s.attempts + 1 } : s
  switch (e.kind) {
    case 'status': {
      const st = e.status
      if (st.phase === 'starting') return { ...s, status: null, phase: s.shown ? s.phase : 'starting' }
      if (st.phase === 'idle') return { ...s, status: null, phase: s.shown ? 'ready' : s.phase === 'empty' ? 'empty' : 'rendering' }
      return { ...s, status: st, phase: 'compiling' }
    }
    case 'drawn':
      return { ...s, shown: true, phase: s.phase === 'compiling' ? 'compiling' : 'ready' }
    case 'lost':
      return { ...s, phase: 'gone', attempts: 0 }
    case 'retry':
      return s
    case 'boards':
      if (e.count) return s.phase === 'empty' ? { ...s, phase: 'rendering' } : s
      return s.shown || s.phase === 'compiling' ? s : { ...s, status: null, phase: 'empty' }
  }
}

/** The one line under the mark or in the header; empty when ready. */
export function loadText(s: Load): string {
  const st = s.status
  switch (s.phase) {
    case 'starting':
      return 'starting the dev server'
    case 'rendering':
      return 'rendering'
    case 'ready':
      return ''
    case 'empty':
      return 'Select a board file to get started'
    case 'gone':
      return s.attempts ? `reconnecting, attempt ${s.attempts}` : 'the dev server stopped'
    case 'compiling':
      if (!st) return 'compiling'
      if (st.phase === 'routing' && st.legs) return `routing ${st.legs} ${st.legs === 1 ? 'leg' : 'legs'}${st.round ? `, round ${st.round}` : ''}`
      return `compiling ${st.name ?? st.entry}`
  }
}

/** A status in progress, which the spinner beside it shows. */
export const loadBusy = (s: Load) => s.phase === 'starting' || s.phase === 'compiling' || s.phase === 'rendering'

/** The look of the loading screen for the state, see boot-screen.js. */
export const loadScreenState = (s: Load) => (s.phase === 'gone' ? 'gone' : s.phase === 'empty' ? 'idle' : 'loading')

/** 0 to 1 when the server reports it: entries done, and the router's legs within the current one or its current round; null otherwise. */
export function loadProgress(s: Load): number | null {
  const st = s.status
  if (s.phase !== 'compiling' || !st) return null
  const legs = st.phase === 'routing' && st.legs ? (st.routed ?? 0) / st.legs : null
  if (legs === null && st.total < 2) return null
  return Math.min(1, (st.done + (legs ?? 0)) / st.total)
}

/** The name under the mark: the board the server compiles, else the project. */
export function loadName(s: Load, project: string | null): string {
  const st = s.status
  return st?.name || project || 'pcbjs'
}
