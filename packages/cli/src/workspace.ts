// docs/cli.md and docs/ide-bridge.md describe the routes and the scope messages.
import { existsSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ViteDevServer } from 'vite'
import { followMode, type ResolvedConfig } from './config.js'
import { viteConfig } from './vite.js'
import type { PluginState } from './plugin.js'
import { parseIdeUrl, readyProtocol } from './host-client.js'
import { listenDev, VERSION, writeDevInfo, type DevOptions, type ReadyInfo } from './server.js'
import { extensionHint } from './ide.js'
import { scopeRoute, scopesInfo, workspaceOf, type Workspace } from './scope-state.js'

export interface WorkspaceOptions extends Omit<DevOptions, 'entries' | 'config' | 'root'> {
  /** the workspace folders, absolute or relative to the working directory */
  folders: string[]
}

/** The stand-in config before a scope is displayed: no entries, the first scope's directory as the root. */
function placeholder(ws: Workspace): ResolvedConfig {
  const root = ws.scopes[0]?.dir ?? ws.folders[0]
  return {
    root,
    configFile: null,
    entries: [],
    outDir: join(root, '.pcbjs', 'dist'),
    fabDir: join(root, '.pcbjs', 'fab'),
    base: '/',
    vite: undefined,
    repo: undefined,
    editor: { follow: followMode(undefined) },
  }
}

export async function devWorkspace(opts: WorkspaceOptions): Promise<{ server: ViteDevServer; workspace: Workspace }> {
  const ide = opts.ide != null ? parseIdeUrl(String(opts.ide), opts.ideAllowRemote).href : undefined
  for (const f of opts.folders) if (!existsSync(f) || !statSync(f).isDirectory()) throw new Error(`workspace folder not found: ${f}`)
  // real paths, as Vite's module graph names files
  const folders = [...new Set(opts.folders.map(f => realpathSync(resolve(f))))]
  const ws = workspaceOf(folders)
  const state: PluginState = { slots: [] }
  if (ide) state.ide = { url: ide }
  state.verbose = !!opts.verbose
  const server = await listenDev(() => viteConfig(placeholder(ws), state, 'dev', ws), opts, state)
  // each scope writes its own .pcbjs/dev.json once loaded, naming its route, for an editor that finds servers started by hand
  ws.onLoaded = sc => {
    const route = scopeRoute(ws, sc)
    const base = server.resolvedUrls?.local?.[0]
    writeDevInfo(server, sc.dir, { scope: sc.slug, route, ...(base ? { url: new URL(route, base).href } : {}) })
  }
  const lines = [`\n  pcbjs dev  workspace ${folders.join(', ')}`]
  if (!ws.scopes.length) lines.push('  scopes     none: no pcb.config.* under the folders')
  for (const sc of ws.scopes) lines.push(`  scope      ${scopeRoute(ws, sc).padEnd(24)} ${sc.dir}`)
  server.config.logger.info(lines.join('\n') + '\n')
  server.printUrls()
  const addr = server.httpServer?.address()
  if (addr && typeof addr === 'object') {
    const h = server.config.server.host
    const urls = [...(server.resolvedUrls?.local ?? []), ...(server.resolvedUrls?.network ?? [])]
    state.host?.send('pcbjs:ide:ready', {
      port: addr.port,
      host: typeof h === 'string' ? h : h ? '0.0.0.0' : 'localhost',
      urls,
      root: folders[0],
      folders,
      pid: process.pid,
      version: VERSION,
      ...readyProtocol(),
    } satisfies ReadyInfo)
  }
  // the scopes before any loads, so an editor host can route files at once
  state.host?.send('pcbjs:ide:scopes', scopesInfo(ws))
  if (process.env.TERM_PROGRAM === 'vscode')
    extensionHint().then(
      h => {
        if (h) server.config.logger.info(h)
      },
      () => {},
    )
  return { server, workspace: ws }
}
