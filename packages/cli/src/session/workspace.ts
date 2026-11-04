// docs/cli.md and docs/ide-bridge.md describe the routes and the scope messages.
import { existsSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { InlineConfig, ViteDevServer } from 'vite'
import type { ResolvedConfig } from '../project/config.js'
import { configOf } from '../server/vite-config.js'
import { CLIENT_DIR } from '../project/vite-base.js'
import { pcbjsPlugin, type DevState } from './plugin.js'
import { scopeOf } from './scopes.js'
import { readyProtocol } from './ide-protocol.js'
import { listenDev, listenInfo, VERSION, type DevOptions } from '../server/listen.js'
import { extensionHint } from './ide.js'
import { scopeRoute, scopesInfo, workspaceOf, type ProjectSpec, type Scope, type Workspace } from './scope-state.js'

/** The session's dev server, where `cfg` stands in for the projects, each run by its own runtime, and project `vite` options do not apply. */
export function devConfig(cfg: ResolvedConfig, state: DevState, ws: Workspace): InlineConfig {
  const of = (f: string) => scopeOf(ws.scopes, f)?.dir ?? null
  const served = { of, shared: (f: string) => of(f) ?? ws.recent?.dir ?? null, folders: ws.folders }
  return configOf(cfg, state, 'dev', served, pcbjsPlugin(CLIENT_DIR, state, ws))
}

export interface WorkspaceOptions extends DevOptions {
  /** the workspace folders, absolute or relative to the working directory, searched for projects */
  folders: string[]
  /** projects served as they are, not searched */
  projects?: ProjectSpec[]
  /** the session's state */
  state: DevState
}

/** The stand-in config before a scope is displayed: no entries, the first scope's directory as the root. */
function placeholder(ws: Workspace): ResolvedConfig {
  const root = ws.scopes[0]?.dir ?? ws.folders[0]
  return {
    root,
    configFile: null,
    configFiles: [],
    entries: [],
    outDir: join(root, '.pcbjs', 'dist'),
    fabDir: join(root, '.pcbjs', 'fab'),
    base: '/',
    vite: undefined,
    repo: undefined,
    plugins: [],
    lib: null,
  }
}

export async function devWorkspace(opts: WorkspaceOptions): Promise<{ server: ViteDevServer; workspace: Workspace }> {
  const projects = (opts.projects ?? []).map(p => ({ ...p, dir: realDir(p.dir) }))
  // real paths, as Vite's module graph names files
  const folders = [...new Set(opts.folders.map(realDir))]
  const ws = workspaceOf(folders, projects)
  ws.command = folders.length ? `pcbjs dev --workspace ${folders.join(' ')}` : 'pcbjs dev'
  const state = opts.state
  state.verbose = !!opts.verbose
  state.uiSrc = opts.uiSrc
  const server = await listenDev(() => devConfig(placeholder(ws), state, ws), opts, state)
  state.ready = () => {
    const at = listenInfo(server)
    return at && { ...at, root: ws.folders[0], folders: ws.folders, pid: process.pid, version: VERSION, ...readyProtocol(), session: state.session.id }
  }
  state.projects = () => ws.scopes.map(sc => ({ root: sc.dir, slug: sc.slug, url: scopeUrl(server, ws, sc) }))
  const lines = [`\n  pcbjs dev  ${projects.length && !folders.length ? projects.map(p => p.dir).join(', ') : `workspace ${ws.folders.join(', ')}`}`]
  if (!ws.scopes.length) lines.push('  scopes     none: no pcb.config.* under the folders')
  if (ws.scopes.length > 1 || folders.length) for (const sc of ws.scopes) lines.push(`  scope      ${scopeRoute(ws, sc).padEnd(24)} ${sc.dir}`)
  server.config.logger.info(lines.join('\n') + '\n')
  server.printUrls()
  // the scopes before any loads, so an editor can route files at once
  state.clients?.relay('pcbjs:ide:scopes', scopesInfo(ws))
  if (process.env.TERM_PROGRAM === 'vscode')
    extensionHint().then(
      h => {
        if (h) server.config.logger.info(h)
      },
      () => {},
    )
  return { server, workspace: ws }
}

function realDir(f: string): string {
  if (!existsSync(f) || !statSync(f).isDirectory()) throw new Error(`folder not found: ${f}`)
  return realpathSync.native(resolve(f))
}

/** The page of a scope on this server. */
export function scopeUrl(server: ViteDevServer, ws: Workspace, sc: Scope): string {
  const at = listenInfo(server)
  const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${at?.port ?? 5173}/`
  return new URL(scopeRoute(ws, sc), base).href
}
