import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createServer, type InlineConfig, type ViteDevServer } from 'vite'
import { resolveConfig } from './config.js'
import { viteConfig } from './vite.js'
import { pluginState, type PluginState } from './plugin.js'
import { extensionHint } from './ide.js'
import { IDE_MAJOR, IDE_PROTOCOL, parseIdeUrl, readyProtocol } from './host-client.js'
import { PKG_DIR } from './vite.js'

export interface DevOptions {
  entries?: string[]; root?: string; config?: string
  /** 0 lets the system pick a free port; unset tries 5173 and the ports after it */
  port?: number
  host?: string | boolean; open?: boolean
  /** an editor host to dial, `ws://127.0.0.1:<port>/<token>` */
  ide?: string
  /** let `ide` name a host other than 127.0.0.1, localhost or [::1] */
  ideAllowRemote?: boolean
  /** keep Vite's report of a failed module with its stack */
  verbose?: boolean
}

/** `.pcbjs/dev.json` while a dev server runs. */
export interface DevInfo {
  port: number; host: string; urls: string[]; root: string; pid: number; startedAt: string
  /** `/`, or `/<scope>/` on a workspace server with several scopes */
  route: string
  scope?: string
  url?: string
  protocol?: number; major?: number; version?: string
}

/** `pcbjs:ide:ready`. */
export interface ReadyInfo {
  port: number; host: string; urls: string[]; root: string; pid: number; version: string
  /** a workspace server's folders, `root` first */
  folders?: string[]
  protocol: number; major: number; capabilities: string[]
}

export const VERSION: string = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version

export async function dev(opts: DevOptions): Promise<ViteDevServer> {
  // a bad --ide fails before anything listens
  const ide = opts.ide != null ? parseIdeUrl(String(opts.ide), opts.ideAllowRemote).href : undefined
  const cfg = await resolveConfig(opts.entries ?? [], 'serve', opts.config, opts.root)
  const state = pluginState(cfg)
  if (ide) state.ide = { url: ide }
  state.verbose = !!opts.verbose
  const server = await listenDev(() => viteConfig(cfg, state, 'dev'), opts, state)
  server.config.logger.info(`\n  pcbjs dev  ${cfg.root}\n  ${cfg.entries.length === 1 ? 'entry   ' : 'entries '}   ${cfg.entries.map(e => e.rel).join(', ')}\n`)
  server.printUrls()
  const info = writeDevInfo(server, cfg.root)
  if (info) state.host?.send('pcbjs:ide:ready', { port: info.port, host: info.host, urls: info.urls, root: info.root, pid: info.pid, version: VERSION, ...readyProtocol() } satisfies ReadyInfo)
  if (process.env.TERM_PROGRAM === 'vscode') {
    // never blocks startup and never installs anything; silent when `code` is missing or slow
    extensionHint().then(h => { if (h) server.config.logger.info(h) }, () => {})
  }
  return server
}

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
      state.host?.close(); state.host = null
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
  server.close = () => (closing ??= (async () => {
    state.closing = true
    const opt = server.environments.client?.depsOptimizer
    const deps = (async () => {
      await opt?.scanProcessing
      await Promise.all(Object.values(opt?.metadata.discovered ?? {}).map(d => d.processing))
    })()
    let timer: NodeJS.Timeout | undefined
    const cap = new Promise<void>(done => { timer = setTimeout(done, SETTLE_MS) })
    await Promise.race([Promise.all([state.idle?.(), deps]).catch(() => {}), cap])
    clearTimeout(timer)
    try { await close() } finally { if (--open === 0) await stopEsbuild() }
  })())
}

/** Stop Vite's copy of esbuild; a later call starts it again. */
async function stopEsbuild(): Promise<void> {
  try { await createRequire(import.meta.resolve('vite'))('esbuild').stop() } catch {}
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

const signalled = new WeakSet<ViteDevServer>()

/** Write `<root>/.pcbjs/dev.json`, removed when the server closes or the process ends. */
export function writeDevInfo(server: ViteDevServer, root: string, extra: Partial<DevInfo> = {}): DevInfo | null {
  const file = join(root, '.pcbjs', 'dev.json')
  const addr = server.httpServer?.address() as AddressInfo | null
  if (!addr || typeof addr !== 'object') return null
  const urls = [...(server.resolvedUrls?.local ?? []), ...(server.resolvedUrls?.network ?? [])]
  const h = server.config.server.host
  const info: DevInfo = {
    port: addr.port, host: typeof h === 'string' ? h : h ? '0.0.0.0' : 'localhost', urls, root,
    pid: process.pid, startedAt: new Date().toISOString(), route: '/', version: VERSION, protocol: IDE_PROTOCOL, major: IDE_MAJOR, ...extra,
  }
  mkdirSync(join(root, '.pcbjs'), { recursive: true })
  writeFileSync(file, JSON.stringify(info, null, 2) + '\n')

  let removed = false
  // only our own file: a second server in the same root may have written it since
  const remove = () => {
    if (removed) return
    removed = true
    try { if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) rmSync(file, { force: true }) } catch {}
  }
  server.httpServer!.on('close', remove)
  process.on('exit', remove)
  // Vite closes the server and exits on SIGTERM itself; Ctrl-C and a closed terminal would otherwise skip the exit hook
  server.httpServer!.on('close', () => process.off('exit', remove))
  if (signalled.has(server)) return info
  signalled.add(server)
  for (const sig of ['SIGINT', 'SIGHUP'] as const) {
    process.once(sig, () => { void server.close().finally(() => process.exit(sig === 'SIGINT' ? 130 : 129)) })
  }
  return info
}
