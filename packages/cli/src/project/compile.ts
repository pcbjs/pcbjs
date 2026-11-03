// The project's compile in Node: a Vite server without HTTP that evaluates entries, the slots compiled on it and the one line of a failure.
import { createLogger, createServer, type Logger, type LogLevel, type ViteDevServer } from 'vite'
import { isUserFile, localFrames } from '@pcbjs/core/internal/provenance'
import type { ResolvedConfig } from './config.js'
import { compileConfig } from './vite-base.js'
import { compileEntry, type EntryOptions } from './project.js'
import { markConflicts, type BoardSlot } from './boards.js'
import type { ModuleLoader } from './loader.js'

/** Silent unless --verbose or the project config asks for one. */
export function logLevelFor(cfg: ResolvedConfig, verbose?: boolean): 'info' | 'warn' | 'error' | 'silent' {
  if (verbose) return 'info'
  return (cfg.vite?.logLevel as any) ?? 'silent'
}

/** Without Vite's report of a module that fails to evaluate: pcbjs prints the one line, the stack with --verbose. */
export function quietLogger(level: LogLevel): Logger {
  const logger = createLogger(level, { allowClearScreen: false })
  const error = logger.error.bind(logger)
  logger.error = (msg, o) => {
    if (!strip(msg).includes('Error when evaluating SSR module')) error(msg, o)
  }
  return logger
}

/** No HTTP, no HMR socket, no file watcher unless `watch`. */
export async function compileServer(cfg: ResolvedConfig, o: { verbose?: boolean; watch?: boolean } = {}): Promise<ViteDevServer> {
  const vc = compileConfig(cfg)
  return createServer({
    ...vc,
    logLevel: logLevelFor(cfg, o.verbose),
    customLogger: quietLogger(logLevelFor(cfg, o.verbose)),
    server: { ...vc.server, middlewareMode: true, ws: false, hmr: false, watch: o.watch ? {} : null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    mode: 'production',
  })
}

/** The text without its ANSI colours. */
export const strip = (t: string): string => t.replace(/\x1b\[[0-9;]*m/g, '')

/** One line, then with --verbose the code frame and the stack below it. */
export function errorText(e: any, verbose?: boolean, root?: string): { line: string; detail: string[] } {
  const msg = strip(String(e?.message ?? e))
  const first = msg.split('\n').find(l => l.trim()) ?? msg
  const rel = (f: string) => (root && f.startsWith(root + '/') ? f.slice(root.length + 1) : f)
  // Vite's location of a syntax error, else the first frame of the stack in the project
  let loc = e?.loc?.file ? `${rel(e.loc.file)}:${e.loc.line}:${e.loc.column}: ` : ''
  if (!loc && root && !/\.(m?[jt]sx?):\d+:\d+/.test(first)) {
    const f = localFrames(strip(String(e?.stack ?? ''))).find(f => f.file.startsWith(root + '/') && isUserFile(f.file))
    if (f) loc = `${rel(f.file)}:${f.line}:${f.col}: `
  }
  const detail: string[] = []
  if (verbose) {
    const rest = msg
      .split('\n')
      .slice(msg.split('\n').indexOf(first) + 1)
      .filter(l => l.trim())
    detail.push(...rest)
    if (e?.frame) detail.push(...strip(String(e.frame)).split('\n'))
    const stack = strip(String(e?.stack ?? ''))
      .split('\n')
      .filter(l => /^\s+at /.test(l))
    detail.push(...stack)
  }
  return { line: `${loc}${first}`, detail }
}

/** Keeps on after a failure; the error of a failed one goes in `slot.error`. */
export async function compileSlots(loader: ModuleLoader, cfg: ResolvedConfig, slots: BoardSlot[], errors: Map<BoardSlot, unknown>, o: EntryOptions = {}): Promise<void> {
  for (const s of slots) {
    try {
      s.compiled = await compileEntry(loader, cfg, s.entry, o)
      s.error = null
      errors.delete(s)
    } catch (e: any) {
      s.error = strip(String(e?.message ?? e))
      s.compiled = null
      errors.set(s, e)
    }
  }
  markConflicts(slots)
}
