// `pcbjs script` and `repl`: TypeScript stripped by esbuild, run in a `vm` context holding the board API and ECMAScript's globals only.
// `vm` is no security boundary, which is why a session runs scripts for read-write connections only.
import { createContext, runInContext, type Context } from 'node:vm'
import { transformSync } from 'esbuild'
import type { Board } from '@pcbjs/compile/query'
import { framesOf } from '@pcbjs/core/internal/provenance'
import type { ScriptResult } from '@pcbjs/core/protocol'

/** ms a script may run */
export const SCRIPT_MS = 2000
export const SCRIPT_MAX_MS = 30_000

export interface ScriptGlobals {
  board: Board | null
  boards: Board[]
  snapshot: string
}

/** A context of its own: no require, import, process, timers or fetch, and no code from strings. */
export function scriptContext(g: ScriptGlobals): Context {
  const ctx = createContext({}, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' })
  bind(ctx, g)
  return ctx
}

export function bind(ctx: Context, g: ScriptGlobals): void {
  ctx.board = g.board
  ctx.boards = g.boards
  ctx.snapshot = g.snapshot
}

export const clampMs = (ms: unknown): number => {
  const n = Number(ms)
  return Number.isFinite(n) && n > 0 ? Math.min(n, SCRIPT_MAX_MS) : SCRIPT_MS
}

/** A string raw, undefined nothing, anything else as JSON. */
export function printed(v: unknown): string | null {
  if (v === undefined) return null
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2) ?? null
  } catch {
    return String(v)
  }
}

/** Statements whose last expression is the value; a returned promise is an error. */
export function runScript(code: string, ctx: Context, ms = SCRIPT_MS): ScriptResult {
  let js: string
  try {
    js = transformSync(code, { loader: 'ts', sourcefile: 'script' }).code
  } catch (e: any) {
    const m = e?.errors?.[0]
    return { exit: 1, error: m ? `script:${m.location?.line ?? 1}: ${m.text}` : String(e?.message ?? e) }
  }
  try {
    const v = runInContext(js, ctx, { filename: 'script', timeout: clampMs(ms) })
    if (Object.prototype.toString.call(v) === '[object Promise]') return { exit: 1, error: 'a script runs synchronously: it returned a promise' }
    return { exit: 0, output: printed(v) }
  } catch (e: any) {
    if (e?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return { exit: 124, error: `the script ran past ${clampMs(ms)} ms` }
    const line = framesOf(String(e?.stack ?? '')).find(f => f.file === 'script')?.line
    return { exit: 1, error: `${line ? `script:${line}: ` : ''}${String(e?.message ?? e)}` }
  }
}
