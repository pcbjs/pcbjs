import { readFileSync } from 'node:fs'
import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createServer, type InlineConfig, type ViteDevServer } from 'vite'
import type { PluginState } from './site.js'
import { PKG_DIR } from '../project/vite-base.js'
import type { ReadyInfo, Tiers } from '@pcbjs/core/protocol'

export interface DevOptions {
  /** 0 lets the system pick a free port; unset tries 5173 and the ports after it */
  port?: number
  host?: string | boolean
  open?: boolean
  /** keep Vite's report of a failed module with its stack */
  verbose?: boolean
  /** a @pcbjs/ui checkout to serve from its source */
  uiSrc?: string
}

/** `.pcbjs/dev.json` while a dev server runs. */
export interface DevInfo {
  pid: number
  version: string
  protocol: number
  major: number
  startedAt: string
  /** this project */
  root: string
  /** this project's page, `/<scope>/` on a workspace server with several projects */
  url: string
  /** the keystroke tier's pause and the quiet period before the full compile, ms */
  tiers: Tiers
}

/** Where the server listens, for `pcbjs:ide:ready`; null before it does. */
export function listenInfo(server: ViteDevServer): Pick<ReadyInfo, 'port' | 'host' | 'urls'> | null {
  const addr = server.httpServer?.address() as AddressInfo | null
  if (!addr || typeof addr !== 'object') return null
  const h = server.config.server.host
  const urls = [...(server.resolvedUrls?.local ?? []), ...(server.resolvedUrls?.network ?? [])]
  return { port: addr.port, host: typeof h === 'string' ? h : h ? '0.0.0.0' : 'localhost', urls }
}

export const VERSION: string = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version

const FREE_PORT_TRIES = 5

/** Create the Vite server and listen; Vite reads port 0 as its default, so a free port is probed here, retried if taken. */
export async function listenDev(make: () => InlineConfig, opts: Pick<DevOptions, 'port' | 'host' | 'open'>, state: PluginState): Promise<ViteDevServer> {
  for (let attempt = 1; ; attempt++) {
    const port = opts.port === 0 ? await freePort(opts.host) : opts.port
    const vc = make()
    // --host exposes the server beyond localhost; it then also answers any Host header, so a tunnel or a LAN name works
    vc.server = { ...vc.server, port: port ?? 5173, host: opts.host, open: opts.open, strictPort: port != null, allowedHosts: opts.host ? true : vc.server?.allowedHosts }
    const server = await createServer(vc)
    closeSettled(server, state)
    try {
      await server.listen()
      return server
    } catch (e: any) {
      await server.close().catch(() => {})
      if (opts.port !== 0 || attempt >= FREE_PORT_TRIES || !/already in use|EADDRINUSE/.test(String(e?.message ?? e) + (e?.code ?? ''))) throw e
    }
  }
}

/** ms that close waits for the running compile and the dependency optimizer before closing anyway */
const SETTLE_MS = 2000
let open = 0

// Vite's close during the optimizer's first run leaves esbuild alive, keeping the process up, so this settles first and stops esbuild
function closeSettled(server: ViteDevServer, state: PluginState): void {
  const close = server.close.bind(server)
  let closing: Promise<void> | null = null
  open++
  server.close = () =>
    (closing ??= (async () => {
      state.closing = true
      const opt = server.environments.client?.depsOptimizer
      const deps = (async () => {
        await opt?.scanProcessing
        await Promise.all(Object.values(opt?.metadata.discovered ?? {}).map(d => d.processing))
      })()
      let timer: NodeJS.Timeout | undefined
      const cap = new Promise<void>(done => {
        timer = setTimeout(done, SETTLE_MS)
      })
      await Promise.race([Promise.all([state.idle?.(), deps]).catch(() => {}), cap])
      clearTimeout(timer)
      try {
        await close()
      } finally {
        if (--open === 0) await stopEsbuild()
      }
    })())
}

/** Stop Vite's copy of esbuild; a later call starts it again. */
async function stopEsbuild(): Promise<void> {
  try {
    await createRequire(import.meta.resolve('vite'))('esbuild').stop()
  } catch {}
}

/** A port the system calls free on the host Vite will listen on, for `--port 0`. */
export function freePort(host: string | boolean | undefined): Promise<number> {
  return new Promise((done, fail) => {
    const srv = createNetServer()
    srv.once('error', fail)
    srv.listen(0, host === true ? undefined : host || 'localhost', () => {
      const { port } = srv.address() as AddressInfo
      srv.close(() => done(port))
    })
  })
}
