// What the one-shot commands share with the session they ask: a batched inspect request, a --select check and the time format of their lines.
import type { Board } from '@pcbjs/core/model'
import { boardIndex, resolveRef } from '@pcbjs/core/ref'

/** One request of a batched inspect: a query, the route table, or both as `inspect --lengths <filter>`; `layer` lists one layer's items, of the query's part or net when there is one; `report` is `--references` or `--sch`. */
export interface InspectRequest {
  query?: string
  lengths?: boolean
  layer?: string
  report?: 'references' | 'sch' | 'grids'
}

/** Why a reference names nothing on the board, null when it names something; ?select= and shot take any reference of docs/refs.md. */
export function refProblem(board: Board, ref: string): string | null {
  try {
    resolveRef(boardIndex(board), ref)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

export const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)
