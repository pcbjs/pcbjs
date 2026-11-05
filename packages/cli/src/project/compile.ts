// The project's compile in Node: a Vite server without HTTP that evaluates entries, the slots compiled on it and the one line of a failure.
import { createLogger, createServer, type Logger, type LogLevel, type ViteDevServer } from 'vite'
import { strip } from './errors.js'
export { strip, errorText } from './errors.js'
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
