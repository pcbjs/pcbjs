// Editor tabs for 2D, 3D, schematic and DRC/ERC, with the viewer in an iframe at
// `<page>?ide=1&theme=<kind>&view=<view>&panel=0`; a pane keeps its page as a path and resolves it against the running session's URL.

import * as vscode from 'vscode'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import css from '@pcbjs/viewer/internal/boot.css' with { type: 'text' }
import mark from '@pcbjs/viewer/internal/mark.svg' with { type: 'text' }
import { bootScreen, esc, fillScreen, SCREEN_SCRIPT, type ScreenState } from '@pcbjs/viewer/internal/boot-screen'
import type { PcbjsServer } from './server'
import { running, type Phase } from './phase'
import type { SessionLink } from './link'
import { ThemeName, devUrl, pathOf, themeName, viewerUrl } from './protocol'
import { VIEWS, boardPath, isView, panelTitle, targetSlug, type Board } from './views'
import type { Events, HostPost, ViewName } from '@pcbjs/core/protocol'
import { findingColumn } from './finding-column'

export interface PreviewDeps {
  devtools?: () => boolean
  /** Start the server if needed, with a progress notification until ready. */
  ensureStarted(server: PcbjsServer): Promise<void>
  /** the board the viewers show, for the tab titles */
  board(server: PcbjsServer): Board | undefined
  link?(server: PcbjsServer): SessionLink | undefined
  onChange(): void
  /** the view a panel last had focus in, kept across sessions */
  lastView?: { get(): ViewName | undefined; set(view: ViewName): void }
  /** the panel tab icon pair */
  icon: { light: vscode.Uri; dark: vscode.Uri }
  /** ms a pane waits before it says the server is stopped, default GRACE_MS */
  graceMs?: number
}

/** A pane that starts the server passes through stopped; only a server still stopped after this many ms says so. */
export const GRACE_MS = 2000

interface Pane {
  devtools: boolean
  view: ViewName
  /** 1 for the first pane of a view, 2 and up for more opened on purpose */
  n: number
  panel: vscode.WebviewPanel
  /** what the panel shows now, so state changes that keep the same page do not reload the iframe */
  shown: string
  src: string
  /** The viewer load currently allowed to replace this panel's HTML. */
  load?: object
  /** the path of the page the pane shows, such as `/demo/board/Quad`, kept through a status page so a new session shows the same board; empty for the server's page */
  page: string
  /** px, as the pane's page measured itself */
  size?: { w: number; h: number }
  /** ms timestamp of the pane's first paint, for the grace */
  since: number
  context?: { project: string; board: string; link: SessionLink; target?: string | null }
}

/** `reuse` and `beside` reveal and focus the view's pane where it is, else open one, in the first pane's group or beside; `new` always opens another. */
export type OpenMode = 'reuse' | 'beside' | 'new'

export const PANEL_TYPE = 'pcbjs.preview'

export class Preview implements vscode.Disposable {
  private panes: Pane[] = []
  private target: PcbjsServer | undefined
  private link: SessionLink | undefined
  private page: string | undefined
  /** the external form of each session URL, so a new pane loads its page without a wait */
  private readonly external = new Map<string, string>()
  private readonly subs: vscode.Disposable[] = []
  private stoppedAt: number | undefined
  private graceTimer: NodeJS.Timeout | undefined
  /** the line above a worktree's board naming its agent and task */
  private bannerText: string | undefined
  private disposing = false
  private undoing: Promise<void> = Promise.resolve()
  private readonly sources = new Map<string, string[]>()

  constructor(private readonly deps: PreviewDeps) {
    this.subs.push(vscode.window.onDidChangeActiveColorTheme(() => this.retheme()))
  }

  get server(): PcbjsServer | undefined {
    return this.panes.length ? this.target : undefined
  }

  get visible(): boolean {
    return this.panes.length > 0
  }

  get last(): ViewName {
    return this.deps.lastView?.get() ?? '2d'
  }

  /** The open panes in view order, then by number, with their titles. */
  get tabs(): { view: ViewName; n: number; title: string }[] {
    return VIEWS.flatMap(v => this.of(v).map(p => ({ view: v, n: p.n, title: p.panel.title })))
  }

  /** The view of the focused panel, if one has focus. */
  get active(): ViewName | undefined {
    return this.focused()?.view
  }

  /** The size of a visible pane in the column, once its page reported it. */
  sizeAt(column: vscode.ViewColumn): { w: number; h: number } | undefined {
    return this.panes.find(p => p.panel.viewColumn === column && p.panel.visible && p.size)?.size
  }

  /** Run `fn`, then give the pane that had focus its focus back if `fn` took it. */
  async keepFocus<T>(fn: () => Promise<T>): Promise<T> {
    const pane = this.focused()
    try {
      return await fn()
    } finally {
      if (pane && this.panes.includes(pane) && !pane.panel.active) pane.panel.reveal(undefined, false)
    }
  }

  private focused(): Pane | undefined {
    return this.panes.find(p => p.panel.active)
  }

  /** Inspector commands address only the active editor, never the other board views. */
  devtools(enabled?: boolean): boolean {
    const pane = this.focused()
    if (!pane || !this.deps.devtools?.()) return false
    pane.devtools = enabled ?? !pane.devtools
    void pane.panel.webview.postMessage({ type: 'post', data: { type: 'pcbjs:devtools', enabled: pane.devtools } })
    return true
  }

  private sourceOf(pane: Pane): { root: string; board: string; key: string; link?: SessionLink } | undefined {
    const server = this.target
    if (!server) return
    const routed = /\/board\/([^/?#]+)/.exec(pane.src || pane.page)?.[1]
    const board = pane.context?.board ?? (routed ? decodeURIComponent(routed) : this.deps.board(server)?.name ?? server.boards?.boards[0]?.name)
    if (!board) return
    const root = pane.context?.project ?? this.link?.boards?.root ?? this.link?.scope?.root ?? server.root
    return { root, board, key: `${root}\0${board}`, link: pane.context?.link ?? this.link }
  }

  private contextOf(page: string, link = this.link, previous?: Pane['context']): Pane['context'] {
    if (!link) return
    const pathname = page.split(/[?#]/)[0]
    const scopes = link.scopes?.scopes ?? []
    const scope = [...scopes].sort((a, b) => b.route.length - a.route.length).find(s => within(pathname, s.route))
    const project = scope?.root ?? link.boards?.root ?? link.scope?.root ?? link.root
    const routed = /\/board\/([^/?#]+)/.exec(pathname)?.[1]
    const board = routed ? decodeURIComponent(routed) : this.target && this.deps.board(this.target)?.name
    if (!project || !board) return
    const slug = /\/board\/[^/]+\/([^/]+)/.exec(pathname)?.[1]
    const target = slug ? link.boards?.boards.find(b => b.name === board)?.targets?.find(t => targetSlug(t) === slug) ?? (previous?.target && targetSlug(previous.target) === slug ? previous.target : undefined) : undefined
    return { project, board, link, ...(target ? { target } : {}) }
  }

  private of(view: ViewName): Pane[] {
    return this.panes.filter(p => p.view === view).sort((a, b) => a.n - b.n)
  }

  async toggle(server: PcbjsServer, view = this.last): Promise<void> {
    const pane = this.of(view)[0]
    if (pane && this.target === server) {
      pane.panel.dispose()
      return
    }
    await this.open(server, view)
  }

  /** Show the server in a pane of the view, see OpenMode; a new pane opens beside the active editor group. */
  async open(server: PcbjsServer, view = this.last, mode: OpenMode = 'reuse', startIfNeeded = true): Promise<void> {
    this.retarget(server)
    this.deps.lastView?.set(view)
    const pane = mode === 'new' ? undefined : this.of(view)[0]
    if (pane) pane.panel.reveal(undefined, false)
    else {
      const checks = view === 'checks' ? this.of('checks')[0] : undefined
      this.create(view, view === 'checks' ? this.checksColumn(server) : mode === 'reuse' ? this.panes[0]?.panel.viewColumn : undefined, checks?.context, checks?.page)
    }
    await this.settle(server, startIfNeeded)
  }

  private checksColumn(server: PcbjsServer): vscode.ViewColumn {
    const root = this.deps.link?.(server)?.boards?.root ?? server.root
    const entry = this.deps.board(server)?.entry
    return findingColumn(entry ? path.resolve(root, entry) : undefined, root)
  }

  /** Finding changes reuse the live checks viewer without revealing or reloading it. */
  async finding(server: PcbjsServer, event: Events['pcbjs:ide:finding'], link: SessionLink): Promise<void> {
    if (!link.open || (this.target && this.target !== server) || (!event.finding && !this.of('checks').length)) return
    this.retarget(server)
    const scope = link.scopes?.scopes.find(s => s.root === event.project)
    const boards = scope?.boards ?? link.boards?.boards ?? []
    const entry = boards.find(b => b.name === event.board)?.entry
    const page = boardPath(scope?.route ?? link.scope?.url ?? '/', event.board, event.target)
    const origin = { project: event.project, board: event.board, link, target: event.target }
    let panes = this.of('checks')
    if (!panes.length) panes = [this.create('checks', findingColumn(entry ? path.resolve(event.project, entry) : undefined, event.project), origin, page)]
    await Promise.all(panes.map(async pane => {
      if (pane.context?.link !== link || pane.page !== page) pane.shown = pane.src = ''
      pane.context = origin
      pane.page = page
      await this.show(pane, server, this.phase(server, link), event.board)
    }))
  }

  /** Open all four views, keeping the checks viewer in its preferred editor group. */
  async openAll(server: PcbjsServer): Promise<void> {
    this.retarget(server)
    const from = this.focused()?.view
    let column = vscode.window.tabGroups?.activeTabGroup?.viewColumn ?? vscode.ViewColumn.One
    for (const view of VIEWS) {
      if (view === from) continue
      const pane = this.of(view)[0]
      if (pane) pane.panel.reveal(undefined, true)
      else column = this.create(view, view === 'checks' ? this.checksColumn(server) : column + 1).panel.viewColumn ?? column + 1
    }
    await this.settle(server, true)
  }

  private retarget(server: PcbjsServer): void {
    if (this.target !== server) {
      for (const p of this.panes) {
        p.shown = p.src = p.page = ''
        p.context = undefined
      }
      this.link = this.deps.link?.(server)
      this.page = this.link?.scope?.url ? pathOf(this.link.scope.url) : undefined
    }
    this.target = server
  }

  private create(view: ViewName, column: vscode.ViewColumn = vscode.ViewColumn.Beside, context?: Pane['context'], page = ''): Pane {
    const panel = vscode.window.createWebviewPanel(
      PANEL_TYPE,
      panelTitle('pcbjs', view),
      { viewColumn: column, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    )
    return this.adopt(panel, view, context, page)
  }

  private async settle(server: PcbjsServer, startIfNeeded: boolean): Promise<void> {
    await this.update()
    this.deps.onChange()
    if (startIfNeeded && !server.active) {
      try {
        await this.deps.ensureStarted(server)
      } catch {
        // the panel shows the failure
      }
    }
  }

  /** Take over a panel, a new one or one VS Code restored after a reload; it gets the lowest free number of its view. */
  adopt(panel: vscode.WebviewPanel, view: ViewName, context?: Pane['context'], page = ''): Pane {
    const taken = new Set(this.of(view).map(p => p.n))
    let n = 1
    while (taken.has(n)) n++
    const pane: Pane = { view, n, panel, shown: '', src: '', page, since: Date.now(), context, devtools: false }
    this.panes.push(pane)
    panel.iconPath = this.deps.icon
    panel.webview.options = { enableScripts: true }
    panel.title = panelTitle(this.target ? this.name(this.target) : 'pcbjs', view, n)
    panel.onDidDispose(() => {
      if (!this.panes.includes(pane)) return
      this.panes = this.panes.filter(p => p !== pane)
      if (!this.disposing && pane.view === 'checks' && pane.context?.link.open && !this.of('checks').some(p => sameContext(p.context, pane.context))) {
        const { link, project, board, target } = pane.context
        void link.request('session/select', { project, board, ...(target !== undefined ? { target } : {}), refs: [], finding: null }).catch(() => {})
      }
      this.deps.onChange()
    })
    panel.onDidChangeViewState(() => {
      if (panel.active) this.deps.lastView?.set(view)
    })
    panel.webview.onDidReceiveMessage(msg => {
      if (msg?.type === 'ready' && this.deps.devtools?.()) {
        void panel.webview.postMessage({ type: 'post', data: { type: 'pcbjs:devtools', enabled: pane.devtools } })
      } else if (msg?.type === 'devtools' && typeof msg.enabled === 'boolean' && this.deps.devtools?.()) {
        pane.devtools = msg.enabled
      }
      if (msg?.type === 'restart') void vscode.commands.executeCommand('pcbjs.restart')
      else if (msg?.type === 'start') void vscode.commands.executeCommand('pcbjs.start')
      else if (msg?.type === 'output') void vscode.commands.executeCommand('pcbjs.showOutput')
      else if (msg?.type === 'size' && msg.w > 0 && msg.h > 0) pane.size = { w: msg.w, h: msg.h }
      else if (msg?.type === 'send' && typeof msg.board === 'string' && Array.isArray(msg.refs))
        void vscode.commands.executeCommand('pcbjs.sendToAgent', {
          viewer: true,
          board: msg.board,
          target: typeof msg.target === 'string' ? msg.target : null,
          refs: msg.refs.map(String),
        })
      else if ((msg?.type === 'undo' || msg?.type === 'edit-written') && Array.isArray(msg.files) && msg.files.every((f: unknown) => typeof f === 'string')) {
        const owner = this.sourceOf(pane)
        if (!owner || (typeof msg.board === 'string' && msg.board !== owner.board) || (typeof msg.project === 'string' && path.resolve(msg.project) !== path.resolve(owner.root))) return
        const files = msg.files.map((file: string) => path.resolve(owner.root, file))
        if (msg.type === 'edit-written') {
          if (files.length) this.sources.set(owner.key, files)
        } else {
          const selected = this.sources.get(owner.key) ?? files
          const redo = !!msg.redo
          this.undoing = this.undoing.then(async () => {
            if (this.panes.includes(pane) && owner.link?.open !== false && this.sourceOf(pane)?.key === owner.key && this.sourceOf(pane)?.link === owner.link) await undoIn(selected, panel, redo)
          }).catch(() => {})
        }
      }
      else if (view === 'checks' && msg?.type === 'copy-markdown' && typeof msg.id === 'string' && typeof msg.text === 'string') {
        void vscode.env.clipboard.writeText(msg.text).then(
          () => panel.webview.postMessage({ type: 'post', data: { type: 'pcbjs:copied-markdown', id: msg.id, ok: true } }),
          () => panel.webview.postMessage({ type: 'post', data: { type: 'pcbjs:copied-markdown', id: msg.id, ok: false } }),
        )
      }
    })
    if (!this.paint(pane) && !panel.webview.html) {
      pane.shown = keyOf(WAITING)
      panel.webview.html = statusHtml(WAITING, this.target ? this.name(this.target) : 'pcbjs', view)
    }
    return pane
  }

  /** Load the viewer at once when the server runs and its external URL is known; false when it must wait. */
  private paint(pane: Pane): boolean {
    const server = this.target
    const p = server && this.phase(server, pane.context?.link)
    const base = p?.kind === 'running' ? this.external.get(p.url) : undefined
    if (!server || p?.kind !== 'running' || !base) return false
    pane.load = undefined
    pane.shown = `viewer ${p.url}`
    pane.src = this.srcOf(pane, base)
    pane.panel.webview.html = viewerHtml(pane.src, new URL(base).origin, pane.view, pane.context?.board ?? this.name(server), idle(server), this.bannerText)
    return true
  }

  /** The pane's page on the session's external URL, in the pane's view and the theme. */
  private srcOf(pane: Pane, base: string): string {
    return viewerUrl(new URL(pane.page || this.page || this.target?.page || '/', base).toString(), currentTheme(), pane.view)
  }

  /** The external URL of the running session, once known. */
  private base(): string | undefined {
    const p = this.target && this.phase(this.target)
    return p?.kind === 'running' ? this.external.get(p.url) : undefined
  }

  /** Panels restored before a server was known show it once one is. */
  async resume(server: PcbjsServer): Promise<void> {
    if (!this.panes.length || this.target && this.target !== server) return
    if (!this.target) this.retarget(server)
    await this.settle(server, true)
  }

  /** Load the viewer page again at its current URL, so it registers with the server afresh; one view, or every one. */
  async reload(server: PcbjsServer, view?: ViewName): Promise<void> {
    if (!this.panes.length || this.target !== server) return this.open(server, view)
    for (const p of this.panes) if (!view || p.view === view) p.shown = p.src = ''
    await this.update()
  }

  private name(server: PcbjsServer): string {
    const board = this.deps.board(server)
    return board ? board.title || board.name : server.scope ? path.basename(server.scope.root) : server.name
  }

  /** Keeps each iframe when its URL did not change, and a status page in place when only its status did. */
  async update(): Promise<void> {
    const server = this.target
    if (!server) return
    for (const pane of this.panes) {
      if (!pane.context || pane.context.link.open) continue
      const owner = server.links?.find(link => link.open && link.roots.includes(pane.context!.project))
      if (!owner) continue
      pane.context.link = owner
      const scope = owner.scopes?.scopes.find(s => s.root === pane.context!.project)
      pane.page = boardPath(scope?.route ?? owner.scope?.url ?? '/', pane.context.board, pane.context.target)
      pane.shown = pane.src = ''
    }
    const name = this.name(server)
    const link = this.deps.link?.(server)
    if (link !== this.link) {
      this.link = link
      this.page = link?.scope?.url ? pathOf(link.scope.url) : '/'
      for (const p of this.panes) {
        if (p.context?.link === link || (p.context && !p.context.link.open)) continue
        p.shown = p.src = p.page = ''
        p.context = undefined
      }
    }
    for (const p of this.panes) p.context ??= this.contextOf(p.page || this.page || server.page || '/', link)
    const phase = this.phase(server)
    if (phase.kind !== 'detached') this.stoppedAt = undefined
    else this.stoppedAt ??= Date.now()
    await Promise.all(this.panes.map(p => this.show(p, server, p.context ? this.phase(server, p.context.link) : phase, p.context?.board ?? name)))
  }

  /** What a pane shows of a server that does not run: the loading screen until a detached server is past the grace. */
  private look(pane: Pane, server: PcbjsServer, phase: Exclude<Phase, { kind: 'running' }>): Look {
    if (phase.kind === 'attaching' || phase.kind === 'reconnecting') return STARTING
    if (phase.kind === 'restarting') return phase.clearing ? CLEARING : RESTARTING
    if (phase.kind === 'failed')
      return {
        state: 'failed',
        text: `the dev server failed: ${phase.reason}`,
        busy: false,
        actions: actions(['restart', 'Restart'], ['output', 'Show output']) + log(server.recent(40)),
      }
    const wait = Math.max(this.stoppedAt ?? 0, pane.since) + (this.deps.graceMs ?? GRACE_MS) - Date.now()
    if (wait <= 0) return { state: 'stopped', text: 'the dev server is stopped', busy: false, actions: actions(['start', 'Start'], ['output', 'Show output']) }
    clearTimeout(this.graceTimer)
    this.graceTimer = setTimeout(() => void this.update(), wait)
    return WAITING
  }

  private async show(pane: Pane, server: PcbjsServer, phase: Phase, name: string): Promise<void> {
    pane.panel.title = panelTitle(name, pane.view, pane.n)
    if (phase.kind !== 'running') {
      pane.load = undefined
      const look = this.look(pane, server, phase)
      const key = keyOf(look)
      if (key === pane.shown) return
      const inPlace = pane.shown.startsWith('status ')
      pane.shown = key
      pane.src = ''
      if (inPlace) void pane.panel.webview.postMessage({ type: 'screen', name, ...look, actions: look.actions ?? '' })
      else pane.panel.webview.html = statusHtml(look, name, pane.view)
      return
    }
    const key = `viewer ${phase.url}`
    if (key === pane.shown) return
    const load = pane.load = {}
    const context = pane.context
    const page = pane.page
    const base = await this.externalOf(phase.url)
    if (!this.panes.includes(pane) || pane.load !== load || this.target !== server) return
    pane.load = undefined
    if (pane.context !== context || pane.page !== page) return this.update()
    pane.src = this.srcOf(pane, base)
    pane.panel.webview.html = viewerHtml(pane.src, new URL(base).origin, pane.view, name, idle(server), this.bannerText)
    pane.shown = key
  }

  private phase(server: PcbjsServer, owner?: SessionLink): Phase {
    const link = owner ?? this.link
    return link ? link.open && link.info ? running(devUrl(link.info), link.info) : { kind: 'detached' } : server.state
  }

  private async externalOf(url: string): Promise<string> {
    const known = this.external.get(url)
    if (known) return known
    const ext = (await vscode.env.asExternalUri(vscode.Uri.parse(url))).toString(true)
    this.external.set(url, ext)
    return ext
  }

  /** From `pcbjs/preview` or `pcbjs:ide:scope`, a path: remembered for a theme change or a reload, the frames stay; a pane's page under it keeps its own. */
  follow(server: PcbjsServer, page: string, link?: SessionLink): void {
    if (this.target !== server || (link && link !== this.link)) return
    this.page = page
    const base = this.base()
    for (const p of this.panes) {
      if (p.context?.link !== this.link) continue
      p.page = p.page && within(p.page, page) ? p.page : page
      p.context = this.contextOf(p.page, this.link, p.context)
      if (p.src && base) p.src = this.srcOf(p, base)
    }
  }

  /** Load a page of the server, a path, in every panel, each in its own view: a board's page, or a scope's; a banner above it, or none. */
  async navigate(server: PcbjsServer, page: string, banner?: string): Promise<void> {
    if (this.target !== server) return
    const base = this.base()
    this.bannerText = banner
    this.page = page
    for (const p of this.panes) {
      p.context = this.contextOf(page, this.link)
      void p.panel.webview.postMessage({ type: 'banner', text: banner ?? '' })
      p.page = page
      if (!p.src || !base) continue
      const src = this.srcOf(p, base)
      if (src === p.src) continue
      const before = new URL(p.src), after = new URL(src)
      const oldTarget = /\/board\/[^/]+\/([^/]+)/.exec(before.pathname)?.[1]
      const board = /\/board\/([^/]+)\/?$/.exec(after.pathname)?.[1]
      const scope = (u: URL) => u.pathname.replace(/\/board\/.*$/, '/').replace(/\/?$/, '/')
      p.src = src
      if (board && before.origin === after.origin && scope(before) === scope(after))
        void p.panel.webview.postMessage({ type: 'post', data: { type: 'pcbjs:view', board: decodeURIComponent(board), ...(oldTarget ? { target: null } : {}) } })
      else void p.panel.webview.postMessage({ type: 'src', src: p.src })
    }
  }

  get banner(): string | undefined {
    return this.bannerText
  }

  /** Show a board in every panel. */
  showBoard(server: PcbjsServer, name: string): Promise<void> {
    return this.phase(server).kind === 'running' ? this.navigate(server, boardPath(this.page ?? server.page ?? '/', name)) : Promise.resolve()
  }

  /** Show another project of a workspace server in every panel, by its route such as `/demo/`; a worktree's with its banner. */
  showScope(server: PcbjsServer, route: string, banner?: string): Promise<void> {
    return this.phase(server).kind === 'running' ? this.navigate(server, pathOf(route), banner) : Promise.resolve()
  }

  /** Pass a request on to the viewer in every panel, such as a net to pin or a finding to pan to. */
  post(data: HostPost): void {
    for (const p of this.panes) if (p.src) void p.panel.webview.postMessage({ type: 'post', data })
  }

  private retheme(): void {
    for (const p of this.panes) {
      if (!p.src) {
        p.shown = ''
        continue
      }
      p.src = viewerUrl(p.src, currentTheme(), p.view)
      void p.panel.webview.postMessage({ type: 'src', src: p.src })
    }
    void this.update()
  }

  dispose(): void {
    this.disposing = true
    clearTimeout(this.graceTimer)
    for (const p of [...this.panes]) p.panel.dispose()
    this.subs.forEach(s => s.dispose())
  }
}

const sameContext = (a: Pane['context'], b: Pane['context']): boolean => !!a && !!b && a.link === b.link && a.project === b.project && a.board === b.board && a.target === b.target

/** The page is the scope's own or one below it, such as a board of it; both paths. */
const within = (page: string, scope: string): boolean => page.split(/[?#]/)[0].startsWith(scope.split(/[?#]/)[0])

/** The view a restored panel had, from the state its page saved. */
export const savedView = (state: unknown): ViewName => {
  const v = (state as { view?: unknown } | undefined)?.view
  return isView(v) ? v : '2d'
}

export function currentTheme(): ThemeName {
  return themeName(vscode.window.activeColorTheme.kind)
}

type Look = { state: ScreenState; text: string; busy: boolean; hint?: string; actions?: string }

const WAITING: Look = { state: 'loading', text: 'waiting for the dev server', busy: true }
const STARTING: Look = { state: 'loading', text: 'attaching to the session', busy: true }
const RESTARTING: Look = { state: 'loading', text: 'restarting the session', busy: true }
const CLEARING: Look = { state: 'loading', text: 'restarting the session, clearing caches', busy: true }
const keyOf = (l: Look) => `status ${l.state} ${l.text} ${l.actions ?? ''}`
const IDLE_HINT = 'or choose one in the Boards view of the pcbjs sidebar'

/** A running server that answered with no board, as its viewer shows it too. */
const idle = (server: PcbjsServer): Look | undefined =>
  server.boards && !server.boards.boards.length ? { state: 'idle', text: 'Select a board file to get started', busy: false, hint: IDLE_HINT } : undefined

const actions = (...list: [cmd: string, label: string][]) => `<div class="buttons">${list.map(([cmd, label]) => `<button data-cmd="${cmd}">${esc(label)}</button>`).join('')}</div>`
const log = (lines: string[]) => (lines.length ? `<pre class="log">${esc(lines.join('\n'))}</pre>` : '')

/** The page around the loading screen of boot-screen.js, in the viewer's theme so its own first paint replaces this one unseen. */
function page(body: string, nonce: string, script: string, frameSrc = ''): string {
  const csp = [
    `default-src 'none'`,
    `frame-src http://127.0.0.1:* http://localhost:*${frameSrc ? ' ' + frameSrc : ''}`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ')
  const theme = currentTheme()
  return `<!doctype html>
<html data-theme="${theme === 'light' ? 'light' : 'dark'}"${theme === 'hc' ? ' data-contrast="high"' : ''}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${css}
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
iframe { position: fixed; inset: 0; z-index: 100; display: block; border: 0; width: 100%; height: 100%; }
#banner { position: fixed; top: 0; left: 0; right: 0; z-index: 200; padding: 3px 10px; font: 12px var(--vscode-font-family, sans-serif); color: var(--vscode-editorInfo-foreground, #fff); background: var(--vscode-editorWidget-background, #1e3a5f); border-bottom: 1px solid var(--vscode-editorInfo-foreground, #3b82f6); }
#banner:empty { display: none; }
#banner:not(:empty) ~ iframe { top: 22px; height: calc(100% - 22px); }
</style><script nonce="${nonce}">${SCREEN_SCRIPT}</script></head><body>${body}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const size = () => vscode.postMessage({ type: 'size', w: innerWidth, h: innerHeight });
addEventListener('resize', size);
size();
${script}
</script></body></html>`
}

/** Native chronological undo in the single document named by the pane, then restore pane focus. */
export async function undoIn(files: string[], panel: vscode.WebviewPanel, redo: boolean): Promise<void> {
  const unique = [...new Set(files)]
  if (!unique.length) {
    void vscode.window.showInformationMessage('pcbjs: this pane has no source document to undo. Use Undo or Redo in the source editor.')
    return
  }
  if (unique.length !== 1) {
    void vscode.window.showInformationMessage('pcbjs: this edit spans multiple source documents. Use Undo or Redo in each source editor. No document was changed.')
    return
  }
  try {
    for (const file of unique) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file))
      const shown = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString())?.viewColumn
      const code = vscode.window.tabGroups.all.find(g => g.viewColumn !== panel.viewColumn && !isPaneTab(g.activeTab))?.viewColumn
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false, viewColumn: shown ?? code ?? vscode.ViewColumn.Beside })
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      if (!(tab?.input instanceof vscode.TabInputText) || tab.input.uri.toString() !== doc.uri.toString() || vscode.window.activeTextEditor?.document.uri.toString() !== doc.uri.toString()) throw new Error('the source editor did not take focus; no undo was requested')
      await vscode.commands.executeCommand(redo ? 'redo' : 'undo')
      vscode.window.setStatusBarMessage(`pcbjs: ${redo ? 'Redo' : 'Undo'} in ${file}, using its chronological source history`, 3000)
    }
  } catch (err) {
    void vscode.window.showInformationMessage(`pcbjs: cannot ${redo ? 'redo' : 'undo'} in ${unique[0]}: ${(err as Error).message}`)
  } finally {
    panel.reveal(undefined, false)
  }
}

const isPaneTab = (t: vscode.Tab | undefined) => t?.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith(PANEL_TYPE)

function viewerHtml(src: string, origin: string, view: ViewName, name: string, look?: Look, banner = ''): string {
  const nonce = randomBytes(16).toString('base64')
  const extra = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ? '' : origin
  const under = look ?? { state: 'loading', text: 'loading the viewer', busy: true }
  return page(
    `<div class="boot">${bootScreen({ mark, name, ...under })}</div><div id="banner">${esc(banner)}</div><iframe id="viewer" src="${esc(src)}" allow="clipboard-read; clipboard-write"></iframe>`,
    nonce,
    `vscode.setState({ view: ${JSON.stringify(view)} });
let frame = document.getElementById('viewer');
let ready = false;
let pending = [];
const send = (data) => frame.contentWindow.postMessage(data, new URL(frame.src).origin);
// a chord the viewer did not take, dispatched again on this page, where VS Code's webview host listens and hands it to the workbench
const forwardKey = (m) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: m.key, code: String(m.code ?? ''), keyCode: Number(m.keyCode) || 0, metaKey: !!m.metaKey, ctrlKey: !!m.ctrlKey, altKey: !!m.altKey, shiftKey: !!m.shiftKey, repeat: !!m.repeat, bubbles: true, cancelable: true }));
addEventListener('message', (e) => {
  const m = e.data;
  if (e.source === frame.contentWindow) {
    if (m && m.type === 'pcbjs:ready') { ready = true; for (const data of pending) send(data); pending = []; vscode.postMessage({ type: 'ready' }); }
    else if (m && m.type === 'pcbjs:devtools' && typeof m.enabled === 'boolean') vscode.postMessage({ type: 'devtools', enabled: m.enabled });
    else if (m && m.type === 'pcbjs:send') vscode.postMessage({ type: 'send', board: m.board, target: m.target, refs: m.refs });
    else if (m && m.type === 'pcbjs:undo' && Array.isArray(m.files)) vscode.postMessage({ type: 'undo', files: m.files, redo: !!m.redo, board: m.board, project: m.project });
    else if (m && m.type === 'pcbjs:edit-written' && Array.isArray(m.files) && typeof m.board === 'string') vscode.postMessage({ type: 'edit-written', files: m.files, board: m.board, project: m.project });
    else if (m && m.type === 'pcbjs:copy-markdown' && typeof m.id === 'string' && typeof m.text === 'string') vscode.postMessage({ type: 'copy-markdown', id: m.id, text: m.text });
    else if (m && m.type === 'pcbjs:key' && typeof m.key === 'string') forwardKey(m);
    return;
  }
  if (m && m.type === 'src' && typeof m.src === 'string') {
    ready = false; pending = [];
    const next = frame.cloneNode();
    next.src = m.src;
    frame.replaceWith(next);
    frame = next;
  }
  else if (m && m.type === 'banner') document.getElementById('banner').textContent = m.text;
  else if (m && m.type === 'post') { if (ready || m.data?.type === 'pcbjs:devtools') send(m.data); if (!ready) pending.push(m.data); }
});`,
    extra,
  )
}

function statusHtml(look: Look, name: string, view: ViewName): string {
  const nonce = randomBytes(16).toString('base64')
  return page(
    `<div class="boot">${bootScreen({ mark, name, ...look })}</div>`,
    nonce,
    `vscode.setState({ view: ${JSON.stringify(view)} });
const fill = ${fillScreen};
const screen = document.querySelector('.load-screen');
addEventListener('message', (e) => {
  const m = e.data;
  if (!m || m.type !== 'screen') return;
  fill(screen, m);
  screen.querySelector('.load-actions').innerHTML = m.actions;
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cmd]');
  if (b) vscode.postMessage({ type: b.dataset.cmd });
});`,
  )
}
