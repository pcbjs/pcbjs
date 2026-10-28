// Editor tabs of the viewer, each fixed to one view, 2D, 3D or Schematic, with the viewer in an iframe at
// `<devUrl>?ide=1&theme=<kind>&view=<view>&panel=0`; the viewer follows editor focus through the server by itself.

import * as vscode from 'vscode'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import css from '@pcbjs/viewer/src/boot.css' with { type: 'text' }
import mark from '@pcbjs/viewer/src/mark.svg' with { type: 'text' }
import { bootScreen, esc, fillScreen, SCREEN_SCRIPT, type ScreenState } from '@pcbjs/viewer/src/boot-screen.js'
import type { PcbjsServer } from './server'
import { ThemeName, themeName, viewerUrl } from './protocol'
import { VIEWS, boardUrl, isView, panelTitle, type Board, type ViewKind } from './views'

export interface PreviewDeps {
  /** Start the server if needed, with a progress notification until ready. */
  ensureStarted(server: PcbjsServer): Promise<void>
  /** The URL of an externally started dev server for this root, from the dev.json fallback. */
  externalUrl(root: string): string | undefined
  /** the board the viewers show, for the tab titles */
  board(server: PcbjsServer): Board | undefined
  onChange(): void
  /** the view a panel last had focus in, kept across sessions */
  lastView?: { get(): ViewKind | undefined; set(view: ViewKind): void }
  /** the panel tab icon pair */
  icon: { light: vscode.Uri; dark: vscode.Uri }
  /** ms a pane waits before it says the server is stopped, default GRACE_MS */
  graceMs?: number
}

/** A pane that starts the server passes through stopped; only a server still stopped after this many ms says so. */
export const GRACE_MS = 2000

type View = { kind: 'viewer'; url: string; src: string; external: boolean } | { kind: 'starting' } | { kind: 'failed'; reason: string; lines: string[] } | { kind: 'stopped' }

interface Pane {
  view: ViewKind
  /** 1 for the first pane of a view, 2 and up for more opened on purpose */
  n: number
  panel: vscode.WebviewPanel
  /** what the panel shows now, so state changes that keep the same page do not reload the iframe */
  shown: string
  src: string
  /** px, as the pane's page measured itself */
  size?: { w: number; h: number }
  /** ms timestamp of the pane's first paint, for the grace */
  since: number
}

/** `reuse` and `beside` reveal and focus the view's pane where it is, else open one, in the first pane's group or beside; `new` always opens another. */
export type OpenMode = 'reuse' | 'beside' | 'new'

export const PANEL_TYPE = 'pcbjs.preview'

export class Preview implements vscode.Disposable {
  private panes: Pane[] = []
  private target: PcbjsServer | undefined
  /** the external form of each server URL, so a new pane loads its page without a wait */
  private readonly external = new Map<string, string>()
  private readonly subs: vscode.Disposable[] = []
  private stoppedAt: number | undefined
  private graceTimer: NodeJS.Timeout | undefined

  constructor(private readonly deps: PreviewDeps) {
    this.subs.push(vscode.window.onDidChangeActiveColorTheme(() => this.retheme()))
  }

  get server(): PcbjsServer | undefined {
    return this.panes.length ? this.target : undefined
  }

  get visible(): boolean {
    return this.panes.length > 0
  }

  get last(): ViewKind {
    return this.deps.lastView?.get() ?? '2d'
  }

  /** The open panes in view order, then by number, with their titles. */
  get tabs(): { view: ViewKind; n: number; title: string }[] {
    return VIEWS.flatMap(v => this.of(v).map(p => ({ view: v, n: p.n, title: p.panel.title })))
  }

  /** The view of the focused panel, if one has focus. */
  get active(): ViewKind | undefined {
    return this.focused()?.view
  }

  /** The size of a visible pane in the column, once its page reported it. */
  sizeAt(column: vscode.ViewColumn): { w: number; h: number } | undefined {
    return this.panes.find(p => p.panel.viewColumn === column && p.panel.visible && p.size)?.size
  }

  private focused(): Pane | undefined {
    return this.panes.find(p => p.panel.active)
  }

  private of(view: ViewKind): Pane[] {
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
    else this.create(view, mode === 'reuse' ? this.panes[0]?.panel.viewColumn : undefined)
    await this.settle(server, startIfNeeded)
  }

  /** The two other views beside the focused pane, or all three beside the code, each in its own group to the right. */
  async openAll(server: PcbjsServer): Promise<void> {
    this.retarget(server)
    const from = this.focused()?.view
    let column = vscode.window.tabGroups?.activeTabGroup?.viewColumn ?? vscode.ViewColumn.One
    for (const view of VIEWS) {
      if (view === from) continue
      const pane = this.of(view)[0]
      if (pane) pane.panel.reveal(undefined, true)
      else column = this.create(view, column + 1).panel.viewColumn ?? column + 1
    }
    await this.settle(server, true)
  }

  private retarget(server: PcbjsServer): void {
    if (this.target !== server) for (const p of this.panes) p.shown = p.src = ''
    this.target = server
  }

  private create(view: ViewKind, column: vscode.ViewColumn = vscode.ViewColumn.Beside): Pane {
    const panel = vscode.window.createWebviewPanel(
      PANEL_TYPE,
      panelTitle('pcbjs', view),
      { viewColumn: column, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    )
    return this.adopt(panel, view)
  }

  private async settle(server: PcbjsServer, startIfNeeded: boolean): Promise<void> {
    await this.update()
    this.deps.onChange()
    if (startIfNeeded && !server.active && !this.deps.externalUrl(server.root)) {
      try {
        await this.deps.ensureStarted(server)
      } catch {
        // the panel shows the failure
      }
    }
  }

  /** Take over a panel, a new one or one VS Code restored after a reload; it gets the lowest free number of its view. */
  adopt(panel: vscode.WebviewPanel, view: ViewKind): Pane {
    const taken = new Set(this.of(view).map(p => p.n))
    let n = 1
    while (taken.has(n)) n++
    const pane: Pane = { view, n, panel, shown: '', src: '', since: Date.now() }
    this.panes.push(pane)
    panel.iconPath = this.deps.icon
    panel.webview.options = { enableScripts: true }
    panel.title = panelTitle(this.target ? this.name(this.target) : 'pcbjs', view, n)
    panel.onDidDispose(() => {
      if (!this.panes.includes(pane)) return
      this.panes = this.panes.filter(p => p !== pane)
      this.deps.onChange()
    })
    panel.onDidChangeViewState(() => {
      if (panel.active) this.deps.lastView?.set(view)
    })
    panel.webview.onDidReceiveMessage(msg => {
      if (msg?.type === 'restart') void vscode.commands.executeCommand('pcbjs.restart')
      else if (msg?.type === 'start') void vscode.commands.executeCommand('pcbjs.start')
      else if (msg?.type === 'output') void vscode.commands.executeCommand('pcbjs.showOutput')
      else if (msg?.type === 'size' && msg.w > 0 && msg.h > 0) pane.size = { w: msg.w, h: msg.h }
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
    const v = server && this.view(server)
    const base = v?.kind === 'viewer' ? this.external.get(v.src) : undefined
    if (!v || v.kind !== 'viewer' || !base) return false
    pane.shown = `viewer ${v.url}`
    pane.src = viewerUrl(base, currentTheme(), pane.view)
    pane.panel.webview.html = viewerHtml(pane.src, new URL(base).origin, pane.view, this.name(server!), idle(server!))
    return true
  }

  /** Panels restored before a server was known show it once one is. */
  async resume(server: PcbjsServer): Promise<void> {
    if (this.target || !this.panes.length) return
    this.retarget(server)
    await this.settle(server, true)
  }

  /** Load the viewer page again at its current URL, so it registers with the server afresh; one view, or every one. */
  async reload(server: PcbjsServer, view?: ViewKind): Promise<void> {
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
    const name = this.name(server)
    const view = this.view(server)
    if (view.kind !== 'stopped') this.stoppedAt = undefined
    else this.stoppedAt ??= Date.now()
    await Promise.all(this.panes.map(p => this.show(p, server, view, name)))
  }

  /** What a pane shows of a server that does not run: the loading screen until a stopped server is past the grace. */
  private look(pane: Pane, view: Exclude<View, { kind: 'viewer' }>): Look {
    if (view.kind === 'starting') return STARTING
    if (view.kind === 'failed')
      return { state: 'failed', text: `the dev server failed: ${view.reason}`, busy: false, actions: actions(['restart', 'Restart'], ['output', 'Show output']) + log(view.lines) }
    const wait = Math.max(this.stoppedAt ?? 0, pane.since) + (this.deps.graceMs ?? GRACE_MS) - Date.now()
    if (wait <= 0) return { state: 'stopped', text: 'the dev server is stopped', busy: false, actions: actions(['start', 'Start'], ['output', 'Show output']) }
    clearTimeout(this.graceTimer)
    this.graceTimer = setTimeout(() => void this.update(), wait)
    return WAITING
  }

  private async show(pane: Pane, server: PcbjsServer, view: View, name: string): Promise<void> {
    pane.panel.title = panelTitle(name, pane.view, pane.n)
    if (view.kind !== 'viewer') {
      const look = this.look(pane, view)
      const key = keyOf(look)
      if (key === pane.shown) return
      const inPlace = pane.shown.startsWith('status ')
      pane.shown = key
      pane.src = ''
      if (inPlace) void pane.panel.webview.postMessage({ type: 'screen', name, ...look, actions: look.actions ?? '' })
      else pane.panel.webview.html = statusHtml(look, name, pane.view)
      return
    }
    const key = `viewer ${view.url}`
    if (key === pane.shown) return
    pane.shown = key
    const base = await this.externalOf(view.src)
    if (!this.panes.includes(pane) || pane.shown !== key) return
    pane.src = viewerUrl(base, currentTheme(), pane.view)
    pane.panel.webview.html = viewerHtml(pane.src, new URL(base).origin, pane.view, name, idle(server))
  }

  private async externalOf(url: string): Promise<string> {
    const known = this.external.get(url)
    if (known) return known
    const ext = (await vscode.env.asExternalUri(vscode.Uri.parse(url))).toString(true)
    this.external.set(url, ext)
    return ext
  }

  /** From `pcbjs/preview` or `pcbjs:ide:scope`: remembered for a theme change or a reload, the frames stay. */
  follow(server: PcbjsServer, url: string | null): void {
    if (this.target !== server || !url) return
    void this.externalOf(url).then(ext => {
      if (this.target !== server) return
      for (const p of this.panes) if (p.src) p.src = viewerUrl(ext, currentTheme(), p.view)
    })
  }

  /** Load a page of the server in every panel, each in its own view: a board's page, or a scope's. */
  async navigate(server: PcbjsServer, url: string): Promise<void> {
    if (this.target !== server) return
    const ext = await this.externalOf(url)
    for (const p of this.panes) {
      if (!p.src) continue
      p.src = viewerUrl(ext, currentTheme(), p.view)
      void p.panel.webview.postMessage({ type: 'src', src: p.src })
    }
  }

  /** Show a board in every panel. */
  showBoard(server: PcbjsServer, name: string): Promise<void> {
    const v = this.view(server)
    return v.kind === 'viewer' ? this.navigate(server, boardUrl(v.src, name)) : Promise.resolve()
  }

  /** Show another project of a workspace server in every panel, by its route such as `/demo/`. */
  showScope(server: PcbjsServer, route: string): Promise<void> {
    const v = this.view(server)
    return v.kind === 'viewer' ? this.navigate(server, new URL(route, v.url).toString()) : Promise.resolve()
  }

  /** Pass a request on to the viewer in every panel, such as a net to pin or a finding to pan to. */
  post(data: object): void {
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

  private view(server: PcbjsServer): View {
    const s = server.state
    // the server's own URL keys the frame; it starts on the page of the project the server shows
    if (s.kind === 'running') return { kind: 'viewer', url: s.url, src: server.previewUrl ?? server.scope?.url ?? s.url, external: false }
    const ext = this.deps.externalUrl(server.root)
    if (ext && !server.active) return { kind: 'viewer', url: ext, src: ext, external: true }
    if (s.kind === 'starting') return { kind: 'starting' }
    if (s.kind === 'failed') return { kind: 'failed', reason: s.reason, lines: server.recent(40) }
    return { kind: 'stopped' }
  }

  dispose(): void {
    clearTimeout(this.graceTimer)
    for (const p of [...this.panes]) p.panel.dispose()
    this.subs.forEach(s => s.dispose())
  }
}

/** The view a restored panel had, from the state its page saved. */
export const savedView = (state: unknown): ViewKind => {
  const v = (state as { view?: unknown } | undefined)?.view
  return isView(v) ? v : '2d'
}

export function currentTheme(): ThemeName {
  return themeName(vscode.window.activeColorTheme.kind)
}

type Look = { state: ScreenState; text: string; busy: boolean; hint?: string; actions?: string }

const WAITING: Look = { state: 'loading', text: 'waiting for the dev server', busy: true }
const STARTING: Look = { state: 'loading', text: 'starting the dev server', busy: true }
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
</style><script nonce="${nonce}">${SCREEN_SCRIPT}</script></head><body>${body}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const size = () => vscode.postMessage({ type: 'size', w: innerWidth, h: innerHeight });
addEventListener('resize', size);
size();
${script}
</script></body></html>`
}

function viewerHtml(src: string, origin: string, view: ViewKind, name: string, look?: Look): string {
  const nonce = randomBytes(16).toString('base64')
  const extra = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) ? '' : origin
  const under = look ?? { state: 'loading', text: 'loading the viewer', busy: true }
  return page(
    `<div class="boot">${bootScreen({ mark, name, ...under })}</div><iframe id="viewer" src="${esc(src)}" allow="clipboard-read; clipboard-write"></iframe>`,
    nonce,
    `vscode.setState({ view: ${JSON.stringify(view)} });
const frame = document.getElementById('viewer');
addEventListener('message', (e) => {
  const m = e.data;
  if (m && m.type === 'src' && typeof m.src === 'string') frame.src = m.src;
  else if (m && m.type === 'post') frame.contentWindow.postMessage(m.data, new URL(frame.src).origin);
});`,
    extra,
  )
}

function statusHtml(look: Look, name: string, view: ViewKind): string {
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
