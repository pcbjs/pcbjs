// The Vite side of the session: the virtual board module, the boot screen and the hot updates that reach the projects' runtimes.
// session/hub.ts runs the projects and everything around them, session/viewers.ts the viewers, session/http.ts the routes.
import { fileKey, under } from '../project/files.js'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Plugin } from 'vite'
import type { Compiled } from '../project/project.js'
import type { Artifact, Held } from '../project/compiler.js'
import type { Snapshot, Snapshots } from './snapshots.js'
import type { EventLog } from './events.js'
import type { Feed } from './feed.js'
import type { ResolvedConfig } from '../project/config.js'
import { ideBridge } from '../server/bridge.js'
import type { DocumentStore } from '@pcbjs/lsp'
import type { Clients, Handlers } from './clients.js'
import { sessionEndpoint } from './endpoint.js'
import type { Ready, ReadyInfo, Stale, Tiers } from '@pcbjs/core/protocol'
import type { EditMode } from './frames.js'
import type { Drafts } from './drafts.js'
import type { Scope, Workspace } from './scope-state.js'
import { scopeOf } from './scopes.js'
import { bootScreen, SCREEN_SCRIPT } from '@pcbjs/viewer/internal/boot-screen'
import { RESOLVED, VIRTUAL, virtualModule, type PluginState } from '../server/site.js'
import { strip } from '../project/compile.js'
import type { Sources } from './sources.js'
import { sessionHub, type Hub } from './hub.js'
import { viewerTools } from './viewers.js'
import { httpRoutes } from './http.js'
import { compiledOf, modelMiddleware } from '../server/models-plugin.js'
import { referenceMiddleware } from '../project/references.js'
import type { BoardOut } from '../project/project.js'

/** The state of the session's dev server. */
export interface DevState extends PluginState {
  /** socket, pipe and /__pcbjs/session connections */
  clients?: Clients
  /** the session around the server: its id, edit mode, token and `session/*` methods */
  session: SessionHooks
  /** where the server listens, for `ready`; set once it does */
  ready?: () => ReadyInfo | null
  /** the projects served, for `ready` */
  projects?: () => Ready['projects']
  /** HTTP requests being answered */
  inflight?: number
  /** a workspace server: tell viewers and editors the scopes changed, and show one */
  announce?: () => void
  show?: (scope: Scope) => Promise<unknown>
  /** a scope no longer served: its runtime stops */
  drop?: (scope: Scope) => Promise<void>
  /** the editor's unsaved buffers, compiled in place of the files */
  drafts?: Drafts | null
  /** the keystroke tier's pause and the quiet period before the full compile, ms */
  tiers?: Tiers
  /** every project's current and previous snapshot */
  snapshots?: Snapshots
  events?: EventLog
  /** what becomes an event: syncs, writes, saves, claims, the cursor and the selection */
  feed?: Feed
  /** a connection began or stopped observing: what each project's observers want, again */
  wake?: () => void
  /** the projects as the session's queries see them */
  api?: ProjectsApi
  /** keep Vite's report of a failed module with its stack, from `--verbose` */
  verbose?: boolean
}

type EditMethod = 'session/edit/begin' | 'session/edit/update' | 'session/edit/commit' | 'session/edit/cancel' | 'session/edit/undo' | 'session/edit/redo'
/** The methods the dev server answers itself. */
export type ViewMethod = 'session/layout' | 'session/select' | 'session/observe' | 'session/resync' | 'session/hover' | 'session/clients' | EditMethod

export interface SessionHooks {
  id: string
  edit: EditMode
  token?: string
  /** every method, once the session made them */
  handlers?: Handlers
  /** the methods the dev server answers, once its plugin made them */
  views?: Pick<Handlers, ViewMethod>
  /** a hello or `session/attach` naming a root no project holds */
  attach?(root: string): Promise<void> | void
  /** a connection or host attached or left */
  onChange?(): void
}

/** One project as a query sees it. */
export interface ProjectApi {
  root: string
  cfg: ResolvedConfig
  current(): Snapshot | null
  previous(): Snapshot | null
  /** settle before answer: compile what changed, within `timeoutMs`, then the snapshot to answer from */
  settle(timeoutMs: number): Promise<{ snap: Snapshot | null; stale: Stale | null }>
  /** the draft holding its compile while its block has an error, which settling compiles as the repair makes it */
  hold(): { file: string; line: number } | null
  /** what stays in the compile thread of a board target it holds */
  artifact<K extends Artifact>(c: Held, kind: K): Promise<Compiled[K]>
}

export interface ProjectsApi {
  /** the project holding a root or file, else the one shown last or the first; loaded on demand */
  find(at?: string): Promise<ProjectApi | null>
  /** the open documents, null before an editor initialized */
  store(): DocumentStore | null
  /** which text of a file is true, and the one path that writes it */
  sources(): Sources
}

/** Design modules under the root, outside node_modules and .pcbjs. */
export const previewable = (root: string, abs: string): boolean =>
  under(abs, root) && /\.(m?[jt]sx?)$/.test(abs) && !/\.d\.m?ts$/.test(abs) && !fileKey(abs).includes('/node_modules/') && !fileKey(abs).includes('/.pcbjs/')

/** The URL an editor's pane is served from, `/pane.html` with the query, for a page route with `?ide=1&view=2d|3d|sch|checks`; null for any other request. */
export function paneUrl(url: string): string | null {
  const [path, query = ''] = url.split(/\?(.*)/s, 2)
  if (/\.[a-z0-9]+$/i.test(path) || path.startsWith('/@') || path.startsWith('/__pcbjs')) return null
  const q = new URLSearchParams(query)
  return q.get('ide') === '1' && /^(2d|3d|sch|checks)$/i.test(q.get('view') ?? '') ? `/pane.html?${query}` : null
}

/** The session's dev server: every project of the workspace through its runtime, `shared` the session's own state. */
export function pcbjsPlugin(clientDir: string, shared: DevState, ws: Workspace): Plugin {
  let hub!: Hub
  // a workspace of one project is that project's site, inlined in the virtual module
  const single = () => (ws.scopes.length === 1 ? ws.scopes[0] : null)
  /** A hot update of a design file reaches the runtimes that read it, never a reload of the page. */
  const design = (file: string) => !under(file, clientDir) && (!!scopeOf(ws.scopes, file) || hub.runtimes().some(rt => rt.reaches(file)))

  return {
    name: 'pcbjs',
    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED
    },
    async load(id) {
      if (id !== RESOLVED) return
      const sc = single()
      const rt = sc ? await hub.show(sc) : null
      // the page mounts at once and fills facet by facet; the first compile starts here when nothing started it
      void rt?.compiledOnce()
      return virtualModule(rt?.state ?? { slots: [] }, hub.workspaceInfo(), hub.status(rt?.root ?? null), rt?.current()?.run ?? null)
    },
    configureServer(s) {
      hub = sessionHub(s, ws, shared, clientDir)
      shared.idle = async () => {
        await Promise.all(hub.runtimes().map(rt => rt.idle()))
      }
      // pcbjs prints the one line of a failed SSR module itself, the stack with --verbose
      {
        const logger = s.config.logger,
          error = logger.error.bind(logger)
        logger.error = (msg, o) => {
          if (!strip(msg).includes('Error when evaluating SSR module')) error(msg, o)
        }
      }
      const tools = viewerTools(hub)
      shared.session.views = tools.views
      hub.attach(tools)
      s.httpServer?.on('upgrade', sessionEndpoint(shared.clients!))
      // an in-flight request holds the session
      s.middlewares.use((_req, res, next) => {
        shared.inflight = (shared.inflight ?? 0) + 1
        res.once('close', () => {
          shared.inflight = (shared.inflight ?? 1) - 1
        })
        next()
      })
      // ahead of the board endpoints since it never waits for a compile
      const bridge = ideBridge(s, req => hub.rootOfRequest(req), {
        clients: tools.clients,
        lsp: hub.lsp() ?? undefined,
        atOf: tools.atOf,
      })
      s.middlewares.use(bridge.middleware)
      shared.announce = hub.announce
      shared.show = hub.show
      shared.drop = hub.drop
      s.middlewares.use(referenceMiddleware())
      s.middlewares.use(modelMiddleware(() => hub.runtimes().map(rt => ({ root: rt.root, compiled: compiledOf<BoardOut>(rt.state) }))))
      s.middlewares.use(httpRoutes(hub))
      // an editor's pane loads the one view it shows: the page of any route with `?ide=1&view=` is pane.html, see viewer/src/pane.ts
      s.middlewares.use((req, _res, next) => {
        const to = req.method === 'GET' ? paneUrl(req.url ?? '/') : null
        if (to) req.url = to
        next()
      })
    },
    // the loading screen's first paint, see boot-screen.js, and what it names before the first board: the project, and how to start the server again
    transformIndexHtml(html) {
      const rt = hub.recent()
      const root = rt?.root ?? ws.folders[0]
      const project = basename(root)
      const status = hub.status(rt?.root ?? null)
      const boot = {
        project,
        root,
        devJson: join(root, '.pcbjs', 'dev.json'),
        command: ws.command ?? `pcbjs dev --workspace ${ws.folders.join(' ')}`,
        status,
      }
      const name = (status.phase === 'compiling' || status.phase === 'routing' ? status.name : null) ?? project
      const text = status.phase === 'starting' ? 'starting the dev server' : 'loading the viewer'
      const screen = bootScreen({ mark: readFileSync(join(clientDir, 'src', 'mark.svg'), 'utf8'), name, text, busy: true })
      return {
        html: html.replace('<body>', `<body><div id="pcbjs-boot" class="boot">${screen}</div>`),
        tags: [
          { tag: 'style', children: readFileSync(join(clientDir, 'src', 'boot.css'), 'utf8'), injectTo: 'head' },
          { tag: 'script', children: `window.__PCBJS_BOOT__ = ${JSON.stringify(boot).replace(/</g, '\\u003c')}\n${SCREEN_SCRIPT}`, injectTo: 'head' },
        ],
      }
    },
    // the ssr environment has no client to reload: the runtimes compile the design
    hotUpdate(opts) {
      if (this.environment.name !== 'ssr' || !design(opts.file)) return
      hub.changed(opts.file)
      return []
    },
    // the client is updated through the pcbjs events, never reloaded; a module shared with the page itself keeps its update
    handleHotUpdate(ctx) {
      if (!design(ctx.file)) return
      hub.changed(ctx.file)
      return scopeOf(ws.scopes, ctx.file) || !ctx.modules.length ? [] : undefined
    },
  }
}
