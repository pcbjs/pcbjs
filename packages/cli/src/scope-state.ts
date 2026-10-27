import { basename } from 'node:path'
import type { DefaultsSnapshot } from '@pcbjs/core/defaults'
import { configFrom, loadUserConfig, type ResolvedConfig } from './config.js'
import { ideBoards, slotsFor, type BoardSlot } from './boards.js'
import { findScopes, NO_DEFAULTS, withDefaults, type ScopeInfo } from './scopes.js'
import type { Preview } from './project.js'
import type { Finding } from '@pcbjs/export/findings'

/** What a scope holds once loaded: its config and board slots, like the state of a one-project dev server. */
export interface ScopeBoards { slots: BoardSlot[]; preview?: Preview | null }

export interface Scope extends ScopeInfo {
  /** unloaded until first use; error when its config failed to load */
  status: 'unloaded' | 'ready' | 'error'
  error: string | null
  cfg: ResolvedConfig | null
  state: ScopeBoards | null
  /** the default board and rules its config and modules declared */
  defaults: DefaultsSnapshot | null
  /** a file of a scope that is not displayed changed since its last compile; it recompiles on its next display */
  stale: boolean
  /** the project files of its module graph at the last compile, config included: the watched set while it is displayed */
  files: string[]
  /** size and mtime of `files` at the last compile */
  stamps: Map<string, string>
  /** the findings of each board and target at its last compile, for the dev log's diff */
  findings: Map<string, Finding[]>
}

export interface Workspace {
  folders: string[]
  scopes: Scope[]
  /** the scope the viewers and HMR follow, null before the first use */
  displayed: Scope | null
  /** called once a scope's config loaded, with the server listening: writes the scope's .pcbjs/dev.json */
  onLoaded?(scope: Scope): void
}

export function workspaceOf(folders: string[]): Workspace {
  const scopes: Scope[] = findScopes(folders).map(s => ({ ...s, status: 'unloaded', error: null, cfg: null, state: null, defaults: null, stale: false, files: [], stamps: new Map(), findings: new Map() }))
  return { folders, scopes, displayed: null }
}

/** The path of a scope's pages: `/<slug>/`, or `/` when the workspace has one scope. */
export const scopeRoute = (ws: Workspace, s: Pick<Scope, 'slug'>): string => (ws.scopes.length === 1 ? '/' : `/${s.slug}/`)

/** Load a scope's config with the default layers emptied, keeping what it declares as its own defaults and restoring the rest. */
export async function loadScope(scope: Scope, log: (line: string) => void): Promise<void> {
  const holder = { defaults: NO_DEFAULTS as DefaultsSnapshot | null }
  try {
    const cfg = await withDefaults(holder, async () => configFrom(await loadUserConfig('serve', scope.configFile, scope.dir), [], log))
    scope.cfg = cfg
    scope.state = { slots: slotsFor(cfg.entries), preview: null }
    scope.defaults = holder.defaults
    scope.status = 'ready'
    scope.error = null
  } catch (e: any) {
    scope.status = 'error'
    scope.error = String(e?.message ?? e).replace(/\x1b\[[0-9;]*m/g, '')
    scope.cfg = null
    scope.state = null
  }
  scope.stale = false
  scope.files = []
  scope.stamps = new Map()
  scope.findings = new Map()
}

/** One scope as the home page and the editor host list it. */
export interface ScopeSummary {
  slug: string
  /** the directory's name */
  name: string
  /** the config directory relative to its workspace folder, '.' for the folder itself */
  dir: string
  /** the config directory, absolute */
  root: string
  route: string
  status: 'unloaded' | 'ok' | 'incomplete' | 'error'
  stale: boolean
  displayed: boolean
  error: string | null
  boards: { name: string; title: string; entry: string; status: string }[]
}

export function scopeSummary(ws: Workspace, s: Scope): ScopeSummary {
  const boards = s.state ? ideBoards(s.state.slots).boards : []
  const failed = s.state ? Object.values(ideBoards(s.state.slots).errors).find(e => e) ?? null : null
  const status = s.status === 'unloaded' ? 'unloaded' : s.status === 'error' || failed ? 'error' : boards.some(b => b.status !== 'ok') ? 'incomplete' : 'ok'
  return {
    slug: s.slug, name: basename(s.dir), dir: s.rel || '.', root: s.dir, route: scopeRoute(ws, s), status, stale: s.stale, displayed: ws.displayed === s,
    error: s.error ?? failed, boards: boards.map(b => ({ name: b.name, title: b.title, entry: b.entry, status: b.status })),
  }
}

/** What the viewers get as `pcbjs:scopes` and the editor host as `pcbjs:ide:scopes`. */
export interface ScopesInfo { scopes: ScopeSummary[]; displayed: string | null; single: boolean }

export const scopesInfo = (ws: Workspace): ScopesInfo => ({ scopes: ws.scopes.map(s => scopeSummary(ws, s)), displayed: ws.displayed?.slug ?? null, single: ws.scopes.length === 1 })
