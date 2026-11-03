import { basename } from 'node:path'
import { configFrom, findConfig, loadUserConfig, type ResolvedConfig } from '../project/config.js'
import { ideBoards, slotsFor, type BoardSlot } from '../project/boards.js'
import { findScopes, slugOf, uniqueSlug, type ScopeInfo } from './scopes.js'
import { inRealm, newRealm, type Realm } from '@pcbjs/core/internal/realm'
import type { Preview } from '../project/project.js'
import type { Compiler, Held } from '../project/compiler.js'
import type { ScopeSummary, ScopesMsg } from '@pcbjs/core/protocol'

/** What a scope holds once loaded: its config and board slots, like the state of a one-project dev server. */
export interface ScopeBoards {
  slots: BoardSlot<Held>[]
  preview?: Preview | null
  /** what compiles its boards, made on first use */
  compiler?: Compiler
}

export interface Scope extends ScopeInfo {
  /** the command line's entries for this project, which win over its config's */
  entries?: string[]
  /** unloaded until first use; error when its config failed to load */
  status: 'unloaded' | 'ready' | 'error'
  error: string | null
  cfg: ResolvedConfig | null
  state: ScopeBoards | null
  /** what its config and modules declared: the parts, the defaults, the KiCad config and the rest */
  realm: Realm
  /** a board of it is older than its files, as no one observed it since an edit; it compiles when a view or a query asks */
  stale: boolean
  /** the project files of its module graph at the last compile, config included: the watched set */
  files: string[]
  /** size and mtime of `files` at the last compile */
  stamps: Map<string, string>
}

export interface Workspace {
  folders: string[]
  scopes: Scope[]
  /** the scope the editor focused or a page opened last, which an editor pane with no scope of its own shows; null before the first */
  recent: Scope | null
  /** how to start the server again, for the page shown once it is gone */
  command?: string
}

const unloaded = (s: ScopeInfo): Scope => ({
  ...s,
  status: 'unloaded',
  error: null,
  cfg: null,
  state: null,
  realm: newRealm(),
  stale: false,
  files: [],
  stamps: new Map(),
})

/** One project served as it is, not searched: its config, `configFile` '' when it has none, and the command line's entries. */
export interface ProjectSpec {
  dir: string
  configFile?: string
  entries?: string[]
}

export function workspaceOf(folders: string[], projects: ProjectSpec[] = []): Workspace {
  const ws: Workspace = { folders: [], scopes: [], recent: null }
  addToWorkspace(ws, folders, projects)
  return ws
}

/** Add the scopes under `folders` and the `projects` that no scope holds yet; returns those added. */
export function addToWorkspace(ws: Workspace, folders: string[], projects: ProjectSpec[] = []): Scope[] {
  const taken = new Set(ws.scopes.map(s => s.slug))
  const seen = new Set(ws.scopes.map(s => s.dir))
  const added: Scope[] = projects
    .filter(p => !seen.has(p.dir))
    .map(p => {
      seen.add(p.dir)
      const configFile = p.configFile ?? findConfig(p.dir) ?? ''
      return { ...unloaded({ slug: uniqueSlug(slugOf('', p.dir), taken), dir: p.dir, folder: p.dir, rel: '', configFile }), ...(p.entries?.length ? { entries: p.entries } : {}) }
    })
  added.push(...findScopes(folders, 8, taken, seen).map(unloaded))
  for (const f of [...projects.map(p => p.dir), ...folders]) if (!ws.folders.includes(f)) ws.folders.push(f)
  ws.scopes.push(...added)
  return added
}

/** The path of a scope's pages: `/<slug>/`, or `/` when the workspace has one scope. */
export const scopeRoute = (ws: Workspace, s: Pick<Scope, 'slug'>): string => (ws.scopes.length === 1 ? '/' : `/${s.slug}/`)

/** Load a scope's config in a realm of its own that keeps the parts its modules made, restoring the process's realm after. */
export async function loadScope(scope: Scope, log: (line: string) => void): Promise<void> {
  const r = { ...newRealm(), registry: scope.realm.registry }
  try {
    const cfg = await inRealm(r, async () => configFrom(await loadUserConfig('serve', scope.configFile || undefined, scope.dir), scope.entries ?? [], log))
    scope.cfg = cfg
    scope.state = { slots: slotsFor(cfg.entries), preview: null }
    scope.realm = r
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
}

/** One scope as the home page and the editor host list it. */
export function scopeSummary(ws: Workspace, s: Scope): ScopeSummary {
  const boards = s.state ? ideBoards(s.state.slots).boards : []
  const failed = s.state ? (Object.values(ideBoards(s.state.slots).errors).find(e => e) ?? null) : null
  const status = s.status === 'unloaded' ? 'unloaded' : s.status === 'error' || failed ? 'error' : boards.some(b => b.status !== 'ok') ? 'incomplete' : 'ok'
  return {
    slug: s.slug,
    name: basename(s.dir),
    dir: s.rel || '.',
    root: s.dir,
    route: scopeRoute(ws, s),
    status,
    stale: s.stale,
    displayed: ws.recent === s,
    error: s.error ?? failed,
    boards: boards.map(b => ({ name: b.name, title: b.title, entry: b.entry, status: b.status })),
  }
}

/** What the viewers get as `pcbjs:scopes` and the editor host as `pcbjs:ide:scopes`. */
export const scopesInfo = (ws: Workspace): ScopesMsg => ({
  scopes: ws.scopes.map(s => scopeSummary(ws, s)),
  displayed: ws.recent?.slug ?? null,
  single: ws.scopes.length === 1,
})
