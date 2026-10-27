// inspect and shot answer from a live dev server's current board through /__pcbjs/cli/, served by devCliEndpoint in plugin.ts
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { DevInfo } from './server.js'

/** What /__pcbjs/cli/board answers for one entry. */
export interface DevBoard {
  /** false when the server has no current board of the entry: never compiled, failed, stale or edited since */
  current: boolean
  reason?: string
  /** the board name, its targets, null for a board without variants, and its refs */
  name?: string
  targets?: (string | null)[]
  refs?: string[]
  /** the compile time of the board on the server, ms, and how long ago it finished */
  ms?: number
  age?: number
  /** the path of the project's pages on the server, `/` or `/<scope>/` */
  route?: string
  /** a workspace server shows one scope at a time: false when another one is displayed */
  displayed?: boolean
}

/** One request of a batched inspect: a query, the route table, or both as `inspect --lengths <filter>`; `layer` lists one layer's items, of the query's part or net when there is one. */
export interface InspectRequest { query?: string; lengths?: boolean; layer?: string }

/** The live dev server of a project: its origin and dev.json; null when there is none or its process is gone. */
export function devServerOf(root: string): { origin: string; info: DevInfo } | null {
  let info: DevInfo
  try { info = JSON.parse(readFileSync(join(root, '.pcbjs', 'dev.json'), 'utf8')) } catch { return null }
  if (!info || typeof info.port !== 'number' || typeof info.pid !== 'number' || info.pid === process.pid) return null
  try { process.kill(info.pid, 0) } catch { return null }
  const url = info.url ?? info.urls?.[0] ?? `http://localhost:${info.port}/`
  try { return { origin: new URL(url).origin, info } } catch { return null }
}

/** GET a /__pcbjs/cli/ path of a dev server as JSON; null on any failure, so the caller compiles itself. */
export async function askDev<T>(origin: string, path: string, params: Record<string, string>, timeout = 180000): Promise<T | null> {
  const q = new URLSearchParams(params)
  try {
    const r = await fetch(`${origin}/__pcbjs/cli/${path}?${q}`, { signal: AbortSignal.timeout(timeout) })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch { return null }
}

/** An entry file as both sides name it: its real path. */
export const realEntry = (file: string): string => { try { return realpathSync(file) } catch { return file } }

export const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)

/** The one line saying the answer came from a dev server. */
export const devLine = (origin: string, entries: string[], ms: number, age: number) =>
  `dev server  ${origin}/  ${entries.join(', ')} current, compiled ${secs(age)} ago in ${secs(ms)}; --fresh compiles here`
