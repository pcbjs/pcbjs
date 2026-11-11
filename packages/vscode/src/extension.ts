import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { INSTALL_HINT, LOCAL_BINS, type PcbjsServer, type Scope } from './server'
import type { SessionLink } from './link'
import { Merger } from './merge'
import { Activity, agentNodes } from './agents'
import { AgentSender, type LastAgent } from './send'
import type { ClientInfo, SelectParams, SessionEvent, ViewName } from '@pcbjs/core/protocol'
import {
  attachWorktree,
  bannerOf,
  changedFiles,
  detachWorktree,
  git,
  listWorktrees,
  ownProjects,
  visibleClients,
  worktreeNodes,
  worktreeStates,
  type Worktree,
  type WorktreeState,
} from './worktrees'
import { Wiring } from './wiring'
import { PANEL_TYPE, Preview, savedView, type OpenMode } from './preview'
import { Sidebar } from './sidebar'
import { reveal, showSelect } from './reveal'
import { actionPage, actionOwner, entryJumper, openFolder, type Action, type Node } from './tree-data'
import { VIEWS, VIEW_NAMES, shownBoard, type Board } from './views'
import { SegmentsUi } from './segments-ui'
import { UnitTokens } from './unit-tokens'
import { PadHints } from './pad-hints'
import { startLanguage } from './language'
import { IconThemeFile, associateIcons, findEntries, iconEnv, workspaceEnv } from './icons'
import { autoIcons, revokeIcons } from './auto-icons'
import type { EditorPort, OpenDoc } from './lsp-client'
import { SelectRequest, pathOf, samePath } from './protocol'
import { checkProject, convertKicad, createProject, installSkills, pcbjsRunner, roots, step, nodeTool, run, type SetupHost } from './setup'
import { fabFindingAction } from './fab'
import { FabPanel, type FabHost } from './fab-panel'
import type { CheckValue } from './fab'
import { installed, type Installed } from './version'
import { holdStatus, type Hold } from './drafts'
import { statusOf } from './status'
import { installFlow } from './install'
import { newFromExample } from './examples'
import { newBoardWizard } from './wizard'
import { DevSuite, stopSuite } from './dev-suite'

const CONFIG_GLOB = '**/pcb.config.{ts,mts,js,mjs}'
/** The walkthrough of package.json `walkthroughs`, opened once where the workspace has no project. */
const WALKTHROUGH = 'getStarted'
const WALKTHROUGH_SHOWN = 'pcbjs.walkthroughShown'

let shutdown: (() => Promise<void>) | undefined

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('pcbjs')
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50)
  const config = (scope?: vscode.Uri) => vscode.workspace.getConfiguration('pcbjs', scope)
  const version = String(context.extension.packageJSON.version ?? '0.0.0')
  /** the train the VSIX was packaged from, as package.mjs stages it; in development the version itself */
  const train = String(context.extension.packageJSON.pcbjs?.train ?? version)
  const fabItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49)
  fabItem.text = '$(package) Fabrication'
  fabItem.tooltip = 'pcbjs: the fab set of every board, whether it is orderable and what blocks it'
  fabItem.command = 'pcbjs.fab'
  /** the one client of the workspace's sessions, while a folder holds a project or a pcbjs, and its server */
  let wiring: Wiring | undefined
  let server: PcbjsServer | undefined
  const lifetime = new AbortController()
  let closing = false
  let maintenance = false
  let discovery = 0
  const devSuite = new DevSuite()
  const syncSettings = { cursorSync: true, followFocus: true }
  let projectDirs: string[] = []
  /** the group a jump to source prefers when it has a choice */
  let editorColumn: vscode.ViewColumn | undefined = vscode.window.activeTextEditor?.viewColumn
  let refreshQueued = false
  /** the last design file in focus and the board the viewers show for it */
  let activeFile = vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor.document.uri.fsPath : undefined
  let shown: string | undefined
  let pickedLink: SessionLink | undefined
  let boardNavigation = 0
  let boardTicket = 0
  let boardPick: { link: SessionLink; entry: string; project?: string; board: Board } | undefined
  let pinnedNet: string | undefined
  const noticed = new Set<string>()
  /** One notice per text and session. */
  const notice = (text: string, ...actions: string[]) => {
    if (noticed.has(text)) return Promise.resolve(undefined)
    noticed.add(text)
    output.appendLine(text)
    return vscode.window.showWarningMessage(text, ...actions)
  }

  const port = (server: PcbjsServer, link: SessionLink): EditorPort => ({
    select: p => {
      if (link === shownLink()) applySelection(p)
    },
    preview: url => {
      preview.follow(server, pathOf(url), link)
    },
    applyEdit: async (uri, edits) => {
      const edit = new vscode.WorkspaceEdit()
      for (const e of edits) edit.replace(vscode.Uri.parse(uri), new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText)
      return vscode.workspace.applyEdit(edit)
    },
    uri: file => vscode.Uri.file(file).toString(),
  })
  const designDocs = (): OpenDoc[] =>
    vscode.workspace.textDocuments
      .filter(d => d.uri.scheme === 'file' && (d.languageId === 'typescriptreact' || d.languageId === 'typescript'))
      .map(d => ({ uri: d.uri.toString(), languageId: d.languageId, version: d.version, text: d.getText() }))
  const handoff = () => wiring?.handoff()
  const sync = () => wiring?.sync

  /** A link said ready: the events it follows and the agents of its session; the wiring starts its language client. */
  function onLink(server: PcbjsServer, conn: SessionLink): void {
    void conn
      .request('session/events', { follow: true, kind: ['edit', 'save', 'compile', 'findings', 'selection', 'message', 'delivered'] })
      .catch(err => output.appendLine(`[session] no events: ${err.message}`))
    void refreshAgents(server)
  }

  const merger = new Merger({ log: line => output.appendLine(`[merge] ${line}`) })
  const activity = new Activity()
  /** each board's selection as the session last logged it */
  const selections = new Map<string, string[]>()
  const sender = new AgentSender({
    request: (method, params) => shownLink()?.request(method, params) ?? Promise.reject(new Error('no session is attached')),
    board: () => shown,
    selection: board => selections.get(board),
    memory: { get: () => context.workspaceState.get<LastAgent>('pcbjs.lastAgent'), set: v => context.workspaceState.update('pcbjs.lastAgent', v) },
  })
  /** Events the session pushes: the log's, followed, and messages sent to the editor. */
  function onSessionEvent(server: PcbjsServer, event: string, data: any): void {
    if (event === 'session/state') {
      sidebar.synced(data?.project, data?.facets)
      held(data?.project, data?.hold ?? null)
      return void throttledAgents(server)
    }
    if ((event !== 'session/event' && event !== 'session/message') || !data?.id) return
    const e = data as SessionEvent
    // a compile event wakes the folder click waiting for its project, see PcbjsServer.whenScope
    if (e.kind === 'compile') return
    if (e.kind === 'selection') return onSelection(server, e.data)
    if (['findings', 'save', 'edit'].includes(e.kind)) fab.schedule()
    sender.event(e)
    // an agent that left greys Send to agent at once
    if (e.kind === 'delivered' && e.data?.returned) void refreshAgents(server)
    if (!activity.event(e)) return
    renderAgents()
    if (e.kind === 'edit' && e.data?.shadowed) void merger.shadowed(path.join(e.project, e.data.file), e.by?.name ?? null)
  }

  /** A board's selection: kept for Stop and tell, and its anchor revealed in the Boards tree when the board is shown. */
  function onSelection(server: PcbjsServer, sel: { board: string; refs: string[]; anchor: string | null }): void {
    if (!sel?.board || !Array.isArray(sel.refs)) return
    selections.set(sel.board, sel.refs)
    if (sel.board === boardOf()?.name) sidebar.reveal(sel.refs, sel.anchor)
  }

  /** A note to one agent with the current selection, through `session/send` as the MCP server reads it. */
  function tell(client: string, title: string): Promise<string | undefined> {
    return sender.tell({ client, name: activity.get(client)?.name ?? client }, title, sender.payload())
  }

  let clientsAt = 0
  let lastClients: ClientInfo[] = []
  const throttledAgents = (server: PcbjsServer) => {
    if (Date.now() - clientsAt >= 4000) void refreshAgents(server)
  }
  /** `session/clients` into the Agent activity view and the Worktrees node. */
  async function refreshAgents(server: PcbjsServer): Promise<void> {
    clientsAt = Date.now()
    try {
      lastClients = await server.request('session/clients')
    } catch {
      return
    }
    await refreshWorktrees(server)
    const shown = visibleClients(lastClients, worktreeList, server.root, server.scopes)
    activity.clients(shown)
    sender.clients(shown)
    renderAgents()
  }
  function renderAgents(): void {
    sidebar.setAgents(agentNodes(activity))
  }

  let worktrees: WorktreeState[] = []
  let worktreeList: Worktree[] = []
  const agentSeen = new Map<string, string>()
  /** Every worktree of the repository with its agent, boards and changes; one is attached to the session only once its board is opened. */
  async function refreshWorktrees(server: PcbjsServer): Promise<void> {
    const list = await listWorktrees(server.root)
    worktreeList = list
    if (list.length < 2) {
      worktrees = []
      sidebar.setWorktrees([])
      return
    }
    const changed = new Map(await Promise.all(list.slice(1).map(async w => [w.path, await changedFiles(w, list[0])] as const)))
    worktrees = worktreeStates(list, lastClients, server.scopes, changed, agentSeen)
    sidebar.setWorktrees(worktreeNodes(worktrees, list[0].path))
  }
  const worktreeOf = (node?: Node) => worktrees.find(w => w.path === node?.worktree)

  /** The preview on the worktree's first board, with a banner naming the agent and its task. */
  async function openWorktreeBoard(at?: string): Promise<void> {
    if (!at || !server) return
    if (await attachWorktree(server, worktrees.find(x => x.path === at) ?? { path: at, attached: false }).catch(() => false)) {
      handoff()
      await refreshWorktrees(server)
    }
    const w = worktrees.find(x => x.path === at)
    if (!w) return
    const scope = w.scopes.find(s => s.route)
    if (!scope?.route) {
      void vscode.window.showInformationMessage(`pcbjs: the session lists no board of ${w.path} yet`)
      return
    }
    if (!preview.visible) await preview.open(server, preview.last, 'beside')
    await preview.showScope(server, scope.route, bannerOf(w))
  }

  /** Detach a worktree Open board attached: the session stops serving it and the preview leaves its board. */
  async function leaveWorktree(node?: Node): Promise<void> {
    const w = worktreeOf(node)
    if (!server || !w) return
    let left: { url: string }[]
    try {
      left = await detachWorktree(server, w)
    } catch (err) {
      void vscode.window.showWarningMessage(`pcbjs: cannot detach ${w.path}: ${(err as Error).message}`)
      return
    }
    if (preview.banner === bannerOf(w) && left[0]) await preview.navigate(server, pathOf(left[0].url))
    handoff()
    await refreshAgents(server)
  }

  async function openWorktreeDiff(node?: Node): Promise<void> {
    const w = worktreeOf(node)
    const main = (await listWorktrees(server?.root ?? ''))[0]
    if (!w || !main) return
    if (!w.changed.length) {
      void vscode.window.showInformationMessage(`pcbjs: ${w.branch ?? w.path} changes nothing against the main tree`)
      return
    }
    const pairs = w.changed.map(f => [vscode.Uri.file(path.join(w.path, f)), vscode.Uri.file(path.join(main.path, f)), vscode.Uri.file(path.join(w.path, f))])
    try {
      await vscode.commands.executeCommand('vscode.changes', `${w.branch ?? path.basename(w.path)} against the main tree`, pairs)
    } catch {
      await openAction({ kind: 'diff', left: path.join(main.path, w.changed[0]), right: path.join(w.path, w.changed[0]), title: w.changed[0] })
    }
  }

  async function mergeWorktree(node?: Node): Promise<void> {
    const w = worktreeOf(node)
    const main = (await listWorktrees(server?.root ?? ''))[0]
    if (!w || !main) return
    if (!w.branch) {
      void vscode.window.showWarningMessage(`pcbjs: ${w.path} is on a detached HEAD, there is no branch to merge`)
      return
    }
    const ok = await vscode.window.showWarningMessage(`Merge ${w.branch} into ${main.branch ?? 'the main tree'}?`, { modal: true }, 'Merge')
    if (ok !== 'Merge') return
    try {
      const out = await git(main.path, ['merge', '--no-edit', w.branch])
      output.appendLine(`[merge] ${w.branch}:\n${out.trim()}`)
      void vscode.window.showInformationMessage(`pcbjs: merged ${w.branch}: ${out.trim().split('\n').pop() ?? 'done'}`)
    } catch (err) {
      output.appendLine(`[merge] ${w.branch} failed:\n${(err as Error).message}`)
      void vscode.window.showErrorMessage(`pcbjs: merging ${w.branch} failed: ${(err as Error).message.split('\n')[0]}`, 'Show output').then(a => a && output.show(true))
    }
    const s = server
    if (s) void refreshWorktrees(s)
  }

  async function stopAndTell(node?: Node): Promise<void> {
    if (!server || !node?.agent) return
    await tell(node.agent, `Stop ${node.label} and tell it`)
  }

  /** Send the active file and cursor again, to whichever server takes them. */
  function resync(accepts: (file: string) => boolean = () => true): void {
    const s = sync()
    if (!s) return
    s.resetFocus()
    const ed = vscode.window.activeTextEditor
    if (ed && ed.document.uri.scheme === 'file' && accepts(ed.document.uri.fsPath)) {
      s.focus(ed.document.uri.fsPath, true)
      reportCursor(ed)
    }
  }
  const sessionOf = (file: string) => wiring?.sessionOf(file)

  const readSyncSettings = () => {
    syncSettings.cursorSync = config().get<boolean>('cursorSync', true)
    syncSettings.followFocus = config().get<boolean>('followFocus', true)
    Object.assign(sync() ?? {}, syncSettings)
  }
  readSyncSettings()

  /** The link the trees and the board pick read: the active file's session, else the first folder's. */
  const shownLink = (): SessionLink | undefined => (activeFile && server?.owner(activeFile)?.link) || (pickedLink?.open ? pickedLink : undefined) || server?.client
  const boardOf = (): Board | undefined => {
    const link = shownLink()
    if (boardPick && boardPick.link === link && (!activeFile || samePath(activeFile, boardPick.entry))) {
      const info = link?.boards
      const entries = info?.boards.filter(b => samePath(path.resolve(info.root ?? link?.root ?? '', b.entry), boardPick!.entry)) ?? []
      const registered = entries.find(b => b.name === boardPick!.board.name)
      if (registered) return registered
      if (!entries.length) return boardPick.board
      boardPick = undefined
    }
    return shownBoard(link?.boards, shown, activeFile, link?.root ?? server?.root)
  }
  const preview = new Preview({
    devtools: () => development(),
    ensureStarted: s => startWithProgress(s),
    board: () => boardOf(),
    link: () => shownLink(),
    lastView: { get: () => context.globalState.get<ViewName>('pcbjs.lastView'), set: v => void context.globalState.update('pcbjs.lastView', v) },
    onChange: () => refresh(),
    icon: {
      light: vscode.Uri.joinPath(context.extensionUri, 'assets', 'icons', 'light', 'preview.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'assets', 'icons', 'dark', 'preview.svg'),
    },
  })

  const development = () =>
    context.extensionMode === vscode.ExtensionMode.Development ||
    vscode.workspace.getConfiguration('pcbjs').get<boolean>('development', false) ||
    (vscode.workspace.workspaceFolders ?? []).some(
      f => fs.existsSync(path.join(f.uri.fsPath, 'packages/ui/src/BoardFrame.vue')) && fs.existsSync(path.join(f.uri.fsPath, 'packages/vscode/src/extension.ts')),
    )
  const developmentContext = () => void vscode.commands.executeCommand('setContext', 'pcbjs.development', development())
  developmentContext()

  const sidebar = new Sidebar()

  const iconFile = new IconThemeFile(context.extensionPath)
  const icons = iconEnv(context)
  void autoIcons(icons)
  let iconTimer: NodeJS.Timeout | undefined
  const refreshIcons = () => {
    if (closing || maintenance) return
    clearTimeout(iconTimer)
    iconTimer = setTimeout(() => {
      void iconFile.refresh(projectDirs)
      void findEntries(projectDirs).then(e => vscode.commands.executeCommand('setContext', 'pcbjs.entries', e))
    }, 300)
  }
  const iconWatchers = [CONFIG_GLOB, '**/.pcbjs/fab/*/*.zip'].map(g => vscode.workspace.createFileSystemWatcher(g))
  for (const w of iconWatchers)
    for (const on of [w.onDidCreate, w.onDidChange, w.onDidDelete])
      context.subscriptions.push(
        on(refreshIcons),
        on(() => fab.schedule(1000)),
      )
  /** whether each document was dirty, so only a change of that refreshes the dialog */
  const dirtyOf = new Map<string, boolean>()

  const segmentsUi = new SegmentsUi(doc => (doc.uri.scheme === 'file' ? sessionOf(doc.uri.fsPath) : undefined))
  const unitTokens = new UnitTokens(doc => (doc.uri.scheme === 'file' ? sessionOf(doc.uri.fsPath) : undefined))
  const padHints = new PadHints(doc => (doc.uri.scheme === 'file' ? sessionOf(doc.uri.fsPath) : undefined))

  const fabHost: FabHost = {
    origin: root => server?.linkOf(root)?.session,
    connected: (root, session) =>
      !!session && !!actionOwner({ kind: 'source', session, project: root, source: { file: root, line: 1, col: 1, endLine: 1, endCol: 1 } }, server?.links ?? []),
    projects: () => {
      const s = server
      const served = s?.scopes?.scopes.map(sc => sc.root) ?? []
      return served.length ? served : projectDirs
    },
    check: async root => {
      const s = server
      if (!s) throw new Error('no pcbjs session is attached')
      await startWithProgress(s)
      const link = s.linkOf(root)
      if (!link) throw new Error('no pcbjs session is attached')
      const e = await link.request('session/check', { project: root, report: true }, 300000)
      // the report and the fab sets are the CLI's own records, read here as the fab panel lays them out
      return { ...(e.value as CheckValue), session: link.session }
    },
    openFinding: (a, origin) => openAction(fabFindingAction(a, origin)),
    build: async (root, env) => {
      const pcbjs = pcbjsRunner([root, ...roots()], setup.nodePath(), setup.env)
      return !!(await step(`building the fab sets of ${path.basename(root)}`, pcbjs, ['build', '-q'], root, { ...setup, env: { ...process.env, ...env } }))
    },
  }
  const fab = new FabPanel(fabHost)

  function makeWiring(folders: string[]): Wiring {
    const uri = vscode.Uri.file(folders[0])
    const w: Wiring = new Wiring({
      folders: () => folders,
      candidates: () => projectDirs,
      name: 'vscode-pcbjs',
      version,
      language: (link, owns, holders) => startLanguage(link, folders, version, output, port(w.server, link), owns, holders),
      docs: designDocs,
      onLink: link => onLink(w.server, link),
      onMoved: () => {
        segmentsUi.refresh()
        unitTokens.refresh()
        padHints.refresh()
      },
      onResync: accepts => resync(accepts),
      onEvent: (link, event, data) => {
        if (event === 'pcbjs:ide:finding') {
          if (link.open && link === shownLink() && link.roots.includes(data?.project)) void preview.finding(w.server, data, link)
        } else if (link === shownLink()) onSessionEvent(w.server, event, data)
      },
      onMismatch: text => void notice(`pcbjs: ${text}`),
      nodePath: () => findNode(config(uri).get<string>('nodePath', '')),
      output: line => output.appendLine(line),
      onGlobal: bin =>
        void notice(
          `pcbjs: no project in this workspace has pcbjs installed, so the global ${bin} runs, whatever its version. Run \`${INSTALL_HINT}\` in the project so it runs its own.`,
          'Copy command',
        ).then(a => {
          if (a) void vscode.env.clipboard.writeText(INSTALL_HINT)
        }),
      onScope: (scope, link) => {
        if (scope.url) preview.follow(w.server, pathOf(scope.url), link)
      },
      onChange: (prev, next) => {
        if (next.kind === 'failed' && prev.kind !== 'failed') notifyFailure(w.server)
        refresh()
      },
    })
    Object.assign(w.sync, syncSettings)
    return w
  }
  /** the folders the server was made for */
  let serverKey = ''

  /** One server for every folder, when any holds a config or a pcbjs; the configs found only say where pcbjs may be installed. */
  async function discover(): Promise<void> {
    if (closing || maintenance) return
    const ticket = ++discovery
    const folders: string[] = []
    const dirs = new Set<string>()
    let any = false
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue
      folders.push(folder.uri.fsPath)
      const configs = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, CONFIG_GLOB), '{**/node_modules/**,**/.claude/**}')
      const own = await ownProjects(
        folder.uri.fsPath,
        configs.map(c => path.dirname(c.fsPath)),
      )
      for (const d of own) dirs.add(d)
      if (own.length || LOCAL_BINS.some(b => fs.existsSync(path.join(folder.uri.fsPath, b)))) any = true
    }
    if (closing || maintenance || ticket !== discovery) return
    projectDirs = [...dirs]
    refreshIcons()
    const key = any ? folders.join('\n') : ''
    if (key !== serverKey) {
      void wiring?.dispose()
      wiring = key ? makeWiring(folders) : undefined
      server = wiring?.server
      serverKey = key
    }
    void vscode.commands.executeCommand('setContext', 'pcbjs.active', !!server)
    segmentsUi.refresh()
    padHints.refresh()
    if (config().get<boolean>('autoStart', false) && server?.state.kind === 'detached') void server.start()
    refresh()
    if (server) void preview.resume(server)
  }

  /** The server, or a warning that the workspace has no project. */
  function need(): PcbjsServer | undefined {
    if (closing || maintenance) return undefined
    if (!server)
      void vscode.window.showWarningMessage(`pcbjs: no pcbjs project in this workspace. A project has a pcb.config.ts, or @pcbjs/pcbjs in node_modules: ${INSTALL_HINT}.`)
    return server
  }

  async function startWithProgress(server: PcbjsServer): Promise<void> {
    if (server.state.kind === 'running') return
    if (!server.active && server.state.kind !== 'restarting') void server.start()
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `pcbjs: attaching to the session of ${server.name}`, cancellable: true },
      (_p, token) =>
        new Promise<void>((ok, fail) => {
          token.onCancellationRequested(() => ok())
          server.whenReady().then(() => ok(), fail)
        }),
    )
  }

  function notifyFailure(server: PcbjsServer): void {
    const s = server.state
    if (s.kind !== 'failed') return
    if (s.hint === 'install') {
      void vscode.window.showErrorMessage(`pcbjs: pcbjs is not installed for ${server.name}. Run \`${INSTALL_HINT}\` in ${server.root}.`, 'Copy command').then(a => {
        if (a) void vscode.env.clipboard.writeText(INSTALL_HINT)
      })
    } else if (s.hint === 'node') {
      void vscode.window.showErrorMessage(`pcbjs: ${s.reason}. Set pcbjs.nodePath to a Node 22.12 or newer binary.`, 'Open settings').then(a => {
        if (a) void vscode.commands.executeCommand('workbench.action.openSettings', 'pcbjs.nodePath')
      })
    } else {
      void vscode.window.showErrorMessage(`pcbjs: ${s.reason}`, 'Open session log', 'Show output').then(a => {
        if (a === 'Open session log') void openLog(server)
        else if (a) output.show(true)
      })
    }
  }

  async function selectRange(req: SelectRequest): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(req.file))
    const start = doc.validatePosition(new vscode.Position(req.line - 1, req.col - 1))
    // endCol 1-based inclusive is endCol 0-based exclusive
    const end = doc.validatePosition(new vscode.Position(req.endLine - 1, req.endCol))
    await reveal(doc, new vscode.Selection(start, end), { last: () => editorColumn, size: c => preview.sizeAt(c) })
  }

  /** The session's selection as multi-cursor selections in the primary member's file, the anchor's first; shown only when the anchor changed or the file is already open. */
  let applied: string | undefined
  const selectionKey = (file: string, sels: readonly vscode.Selection[]) =>
    `${file}|${sels.map(s => `${s.start.line}:${s.start.character}-${s.end.line}:${s.end.character}`).join(',')}`
  async function applySelection(p: SelectParams): Promise<void> {
    // a click in a pane shows its source with the cursor there and the pane keeping focus; an Open gives the editor focus
    const deps = { last: () => editorColumn, size: (c: vscode.ViewColumn) => preview.sizeAt(c) }
    const editor = await showSelect(p, deps, (show, valid) => preview.keepFocus(show, valid))
    if (editor) applied = selectionKey(editor.document.uri.fsPath, editor.selections)
  }

  function reportCursor(editor: vscode.TextEditor | undefined): void {
    if (!editor) return
    if (editor.document.uri.scheme !== 'file') {
      sync()?.leave()
      return
    }
    // the change a session selection made is not sent back
    if (applied && applied === selectionKey(editor.document.uri.fsPath, editor.selections)) return
    applied = undefined
    const pos = editor.selection.active
    const ranges = editor.selections.map(s => ({ start: { line: s.start.line, character: s.start.character }, end: { line: s.end.line, character: s.end.character } }))
    sync()?.cursor(editor.document.uri.fsPath, pos.line + 1, pos.character + 1, ranges)
  }

  function onActiveEditor(editor: vscode.TextEditor | undefined): void {
    // the preview has focus: the viewer keeps what it shows
    if (!editor) return
    if (editor.document.uri.scheme !== 'file') {
      reportCursor(editor)
      return
    }
    if (editor.viewColumn) editorColumn = editor.viewColumn
    const file = editor.document.uri.fsPath
    activeFile = file
    if (boardNavigation) return
    if (boardPick && !samePath(file, boardPick.entry)) boardPick = undefined
    sync()?.focus(file)
    reportCursor(editor)
    refresh()
  }

  function refresh(): void {
    if (closing || maintenance || refreshQueued) return
    refreshQueued = true
    queueMicrotask(() => {
      refreshQueued = false
      if (closing || maintenance) return
      const board = boardOf()
      if (board) shown = board.name
      void preview.update()
      void sidebar.update(shownLink(), board)
      updateStatus()
    })
  }

  /** The workspace folder of the active editor, else the first, with the file an install starts from. */
  function versionFolder(): { root: string; file?: string } | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri
    const folder = (uri?.scheme === 'file' && vscode.workspace.getWorkspaceFolder(uri)) || vscode.workspace.workspaceFolders?.find(f => f.uri.scheme === 'file')
    if (!folder) return undefined
    return { root: folder.uri.fsPath, ...(uri?.scheme === 'file' && uri.fsPath.startsWith(folder.uri.fsPath + path.sep) ? { file: uri.fsPath } : {}) }
  }
  let lastInstalled: Installed | undefined
  /** What the active editor's folder resolves, from its file up as Node resolves it. */
  function readInstalled(): Installed {
    const at = versionFolder()
    const i: Installed = at ? installed(at.file ? path.dirname(at.file) : at.root) : { version: null, dir: null, skew: null, linked: false }
    if (lastInstalled === undefined || !!i.version !== !!lastInstalled.version) void vscode.commands.executeCommand('setContext', 'pcbjs.installed', !!i.version)
    lastInstalled = i
    return i
  }

  /** the drafts holding the compile, by project, from `session/state` */
  const holds = new Map<string, Hold>()
  const holdOf = () => [...holds.values()][0]
  function held(project: unknown, hold: Hold | null): void {
    if (typeof project !== 'string') return
    const was = holdStatus(holdOf())
    if (hold) holds.set(project, hold)
    else holds.delete(project)
    if (holdStatus(holdOf()) !== was) updateStatus()
  }

  function updateStatus(): void {
    const s = server
    const inst = readInstalled()
    if (!s) {
      status.hide()
      fabItem.hide()
      return
    }
    fabItem.show()
    const st = statusOf(s.state, inst, holdOf(), shownLink()?.boards?.boards.length ?? 0, syncSettings.cursorSync)
    status.text = st.text
    status.tooltip = st.tooltip
    status.command = st.command
    status.backgroundColor = st.tone ? new vscode.ThemeColor(`statusBarItem.${st.tone}Background`) : undefined
    status.show()
  }

  async function openLog(server: PcbjsServer | undefined): Promise<void> {
    if (!server) return
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(server.logFile), { preview: true })
    } catch {
      void vscode.window.showInformationMessage(`pcbjs: no session log at ${server.logFile} yet.`)
    }
  }

  // a command before discovery ends keeps the walkthrough from taking focus from its dialogs
  let commanded = false
  const command = (id: string, fn: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(id, (...args: never[]) => {
      commanded = true
      return fn(...args)
    })
  context.subscriptions.push(
    output,
    status,
    preview,
    segmentsUi,
    unitTokens,
    padHints,
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      developmentContext()
      void discover()
    }),
    vscode.window.onDidChangeTextEditorSelection(e => {
      if (e.textEditor === vscode.window.activeTextEditor) reportCursor(e.textEditor)
    }),
    vscode.window.onDidChangeActiveTextEditor(onActiveEditor),
    vscode.workspace.onDidCloseTextDocument(doc => {
      if (doc.uri.scheme === 'file') sync()?.close(doc.uri.fsPath)
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('pcbjs.development')) developmentContext()
      if (e.affectsConfiguration('pcbjs.cursorSync') || e.affectsConfiguration('pcbjs.followFocus')) {
        readSyncSettings()
        refresh()
      }
      if (e.affectsConfiguration('pcbjs.autoStart')) void discover()
      if (e.affectsConfiguration('workbench.iconTheme')) {
        refreshIcons()
        void autoIcons(icons)
      }
    }),
    command('pcbjs.preview', async () => {
      const s = need()
      if (s) await preview.toggle(s)
    }),
    command('pcbjs.dev.purgeReload', async () => {
      if (maintenance || closing) return
      let reloading = false
      try {
        reloading = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'pcbjs: Purge Reload Dev Suite' }, progress =>
          devSuite.run({
            development,
            signal: lifetime.signal,
            folders: roots,
            projects: () => [...projectDirs, ...(server?.served ?? [])],
            save: () => vscode.workspace.saveAll(false),
            disconnect: async () => {
              maintenance = true
              discovery++
              boardTicket++
              clearTimeout(iconTimer)
              const old = wiring
              wiring = undefined
              server = undefined
              serverKey = ''
              await old?.dispose()
            },
            stop: stopSuite,
            run: async (tool, args, root) => {
              const runner =
                tool === 'npm' ? nodeTool(setup.nodePath(), 'npm', []) : { command: setup.nodePath(), args: [path.join(root, 'packages/pcbjs/bin/pcbjs.js')], shell: false }
              const result = await run(runner, args, root, setup)
              if (result.code !== 0) throw new Error(`${tool} ${args.join(' ')} failed: ${result.lines.filter(l => l.trim()).at(-1) ?? result.code}`)
            },
            reload: () => vscode.commands.executeCommand('workbench.action.reloadWindow'),
            progress: message => {
              progress.report({ message })
              output.appendLine(`[dev suite] ${message}`)
            },
          }),
        )
      } catch (e) {
        if (closing) return
        output.appendLine(`[dev suite] ${String(e)}`)
        output.show(true)
        void vscode.window.showErrorMessage(`pcbjs: purge stopped. ${e instanceof Error ? e.message : String(e)}. Fix the reported step and run the command again.`)
      } finally {
        if (!reloading) maintenance = false
      }
    }),
    ...(['toggle', 'enable', 'disable'] as const).map(action =>
      command(`pcbjs.devtools.${action}`, () => {
        const applied = preview.devtools(action === 'toggle' ? undefined : action === 'enable')
        if (!applied && development()) void vscode.window.showInformationMessage('pcbjs: focus a preview editor to inspect its UI.')
        return applied
      }),
    ),
    ...VIEWS.flatMap(v => (Object.keys(OPEN_COMMANDS) as OpenMode[]).map(mode => command(OPEN_COMMANDS[mode][v], (node?: Node) => openView(v, mode, node)))),
    command('pcbjs.openAllViews', async () => {
      const s = need()
      if (s) await preview.openAll(s)
    }),
    command('pcbjs.pickView', async () => {
      type Item = vscode.QuickPickItem & { view?: ViewName; mode?: OpenMode }
      const item = (v: ViewName, mode: OpenMode): Item => ({ label: `$(${VIEW_ICONS[v]}) ${VIEW_NAMES[v]}`, view: v, mode })
      const items: Item[] = [
        ...VIEWS.map(v => item(v, 'beside')),
        { label: '$(split-horizontal) All three side by side' },
        { label: 'New pane', kind: vscode.QuickPickItemKind.Separator },
        ...VIEWS.map(v => item(v, 'new')),
      ]
      const chosen = await vscode.window.showQuickPick(items, { placeHolder: 'Open which view of the board?' })
      if (!chosen) return
      if (chosen.view && chosen.mode) await openView(chosen.view, chosen.mode)
      else await vscode.commands.executeCommand('pcbjs.openAllViews')
    }),
    vscode.commands.registerCommand('pcbjs.sidebar.open', (a: Action) => (a.kind === 'board' ? openBoardRow(a) : a.kind === 'scope' ? openFolderRow(a) : openAction(a))),
    vscode.window.registerWebviewPanelSerializer(PANEL_TYPE, {
      deserializeWebviewPanel: async (panel, state) => {
        preview.adopt(panel, savedView(state))
        const s = server
        if (s) await preview.resume(s)
      },
    }),
    sidebar,
    command('pcbjs.start', async () => {
      const s = need()
      if (s) await startWithProgress(s).catch(() => undefined)
    }),
    command('pcbjs.stop', async () => {
      const s = need()
      if (s) await s.stop()
    }),
    command('pcbjs.restart', async () => {
      const s = need()
      if (!s) return
      await s.stop()
      await startWithProgress(s).catch(() => undefined)
    }),
    command('pcbjs.restartServer', async () => {
      const s = need()
      if (!s) return
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `pcbjs: restarting the session of ${s.name}` }, () => s.restartServer())
    }),
    command('pcbjs.restartClean', async () => {
      const s = need()
      if (!s) return
      output.appendLine(`[cache] restarting the session of ${s.name} and clearing the caches under ${s.served.join(', ')}`)
      const code = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'pcbjs: restarting, clearing caches' }, () => s.restartClean())
      if (code !== 0) void vscode.window.showWarningMessage('pcbjs: the caches were not cleared, see the output.', 'Show output').then(a => a && output.show(true))
      await preview.reload(s)
      resync()
    }),
    command('pcbjs.openInBrowser', async () => {
      const s = need()
      if (!s) return
      try {
        await startWithProgress(s)
      } catch {
        return
      }
      if (s.url) await vscode.env.openExternal(vscode.Uri.parse(s.url))
    }),
    command('pcbjs.preview.reload', async () => {
      const s = need()
      if (!s) return
      if (!s.active) await startWithProgress(s).catch(() => undefined)
      await preview.reload(s, preview.active)
      resync()
    }),
    command('pcbjs.toggleCursorSync', async () => {
      const next = !config().get<boolean>('cursorSync', true)
      await config().update('cursorSync', next, vscode.ConfigurationTarget.Global)
      readSyncSettings()
      refresh()
      vscode.window.setStatusBarMessage(`pcbjs: cursor sync ${next ? 'on' : 'off'}`, 2000)
    }),
    command('pcbjs.showOutput', () => output.show(true)),
    command('pcbjs.agent.stopAndTell', (node?: Node) => stopAndTell(node)),
    command('pcbjs.sendToAgent', (arg?: unknown, many?: unknown) => sender.run(arg, many)),
    command('pcbjs.worktree.openDiff', (node?: Node) => openWorktreeDiff(node)),
    command('pcbjs.worktree.openBoard', (node?: Node) => openWorktreeBoard(node?.worktree)),
    command('pcbjs.worktree.merge', (node?: Node) => mergeWorktree(node)),
    command('pcbjs.worktree.detach', (node?: Node) => leaveWorktree(node)),
    merger,
    command('pcbjs.openSessionLog', async () => openLog(need())),
    command('pcbjs.createProject', () => createProject(setup)),
    command('pcbjs.convertKicad', () => convertKicad(setup)),
    command('pcbjs.installSkills', () => installSkills(setup)),
    command('pcbjs.newFromExample', () => newFromExample(setup)),
    command('pcbjs.newBoardWizard', () => newBoardWizard(setup)),
    command('pcbjs.check', () => checkProject(setup)),
    command('pcbjs.walkthrough', () => openWalkthrough()),
    command('pcbjs.fab', () => fab.open()),
    command('pcbjs.install', async () => {
      const at = versionFolder()
      if (!at) return void vscode.window.showWarningMessage('pcbjs: open a folder to install pcbjs in.')
      await installFlow({ packaged: train }, at.root, at.file)
    }),
    vscode.window.onDidCloseTerminal(t => t.name === 'pcbjs install' && refresh()),
    vscode.window.onDidChangeWindowState(w => w.focused && refresh()),
    vscode.workspace.onDidSaveTextDocument(() => fab.schedule()),
    vscode.workspace.onDidChangeTextDocument(e => {
      const key = e.document.uri.toString()
      if (e.document.isDirty === dirtyOf.get(key)) return
      dirtyOf.set(key, e.document.isDirty)
      fab.schedule()
    }),
    fab,
    fabItem,
    command('pcbjs.icons.associate', async () => void vscode.window.showInformationMessage(`pcbjs: ${await associateIcons(context.extensionPath, projectDirs)}`)),
    command('pcbjs.icons.revoke', async () => {
      const scopes = vscode.workspace.workspaceFolders?.length ? [icons, workspaceEnv(icons)] : [icons]
      void vscode.window.showInformationMessage(await revokeIcons(icons, scopes))
    }),
    ...iconWatchers,
    { dispose: () => clearTimeout(iconTimer) },
  )

  const setup: SetupHost = {
    output: line => output.appendLine(line),
    showOutput: () => output.show(true),
    nodePath: () => findNode(config().get<string>('nodePath', '')),
    projectDirs: () => projectDirs,
    opened: openProject,
    packaged: train,
  }

  /** Show the board file, add the folder when outside the workspace, and preview it; a running server restarts to find the project. */
  async function openProject(dir: string, file: string): Promise<void> {
    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true })
    if (!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir))) {
      vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri: vscode.Uri.file(dir) })
      return
    }
    await discover()
    const s = server
    if (!s) return
    if (s.active && s.scopes && !s.scopes.scopes.some(sc => samePath(sc.root, dir))) await s.stop()
    await preview.open(s, '2d', 'beside')
  }

  /** From a board in the Boards view, `node`, that board of the current project; else a project picked. */
  async function openView(view: ViewName, mode: OpenMode, node?: Node): Promise<void> {
    const board = node?.action?.kind === 'board' ? node.action : undefined
    if (board?.session && !actionLink(board)) return unavailableAction()
    const s = board ? server : need()
    if (!s) return
    if (board) {
      pickedLink = actionLink(board)
      activeFile = undefined
    }
    await preview.open(s, view, mode)
    if (board) await openAction(board)
  }

  /** Open the exact entry first, suppressing intermediate cursor focus, then select its board in every pane. */
  async function openBoardRow(a: Extract<Action, { kind: 'board' }>): Promise<void> {
    const s = server
    const link = actionLink(a)
    if (!s || !link?.open) return unavailableAction()
    const ticket = ++boardTicket
    boardNavigation++
    try {
      pickedLink = link
      if (a.entry) boardPick = { link, entry: a.entry, project: a.project, board: { name: a.name, title: a.name, entry: a.entry, targets: [], status: 'ok' } }
      activeFile = undefined
      shown = a.name
      if (a.entry) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(a.entry))
        if (ticket !== boardTicket) return
        await reveal(doc, new vscode.Selection(0, 0, 0, 0), { last: () => editorColumn, size: c => preview.sizeAt(c) })
      }
      if (ticket !== boardTicket) return
      if (!link.open) return unavailableAction()
      activeFile = undefined
      shown = a.name
      await preview.update()
      if (ticket !== boardTicket) return
      const page = a.project ? actionPage(a.project, a.name, link) : a.route ? `${a.route.replace(/\/?$/, '/')}board/${encodeURIComponent(a.name)}` : undefined
      if (page) await preview.showScope(s, page)
      else await preview.showBoard(s, a.name)
      if (ticket !== boardTicket) return
      await entryJumper(link, a.project)(a.name)
    } catch (error) {
      if (ticket === boardTicket) boardPick = undefined
      void vscode.window.showInformationMessage(`pcbjs: unable to open ${a.name}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      boardNavigation--
      refresh()
    }
  }

  /** Legacy folder actions only expand the tree; a chevron never navigates. */
  async function openFolderRow(a: Extract<Action, { kind: 'scope' }>): Promise<void> {
    await openFolder(a, { expand: id => sidebar.expand(id) })
  }

  function unavailableAction(): void {
    void vscode.window.showInformationMessage('pcbjs: this design action is unavailable or disconnected. Refresh the view and try again.')
  }

  function actionLink(a: Action): SessionLink | undefined {
    return actionOwner(a, server?.links ?? [], shownLink())
  }

  async function openAction(a: Action): Promise<void> {
    if (a.kind === 'board') return openBoardRow(a)
    if (a.kind === 'scope') return openFolderRow(a)
    const ticket = ++boardTicket
    const link = actionLink(a)
    if ((a.session && !link?.open) || (a.project && (!link?.open || !link.roots.some(root => samePath(root, a.project!))))) {
      unavailableAction()
      return
    }
    pickedLink = link
    activeFile = undefined
    await preview.update()
    if (ticket !== boardTicket || (link && (!link.open || shownLink() !== link))) return
    if (a.project && 'board' in a && link && server) {
      const page = actionPage(a.project, a.board, link)
      if (!page) return unavailableAction()
      await preview.showScope(server, page)
      if (ticket !== boardTicket) return
      if (!link.open || shownLink() !== link) return unavailableAction()
      if (a.kind === 'source') preview.post({ type: 'pcbjs:view', board: a.board, target: a.target })
    }
    if (a.kind === 'net') {
      pinnedNet = pinnedNet === a.net ? undefined : a.net
      preview.post({ type: 'pcbjs:net', board: a.board, target: a.target, net: pinnedNet ?? null })
      return
    }
    if (a.kind === 'worktree') return openWorktreeBoard(a.path)
    if (a.kind === 'diff') {
      await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(a.left), vscode.Uri.file(a.right), a.title)
      return
    }
    if (a.kind === 'finding') preview.post({ type: 'pcbjs:finding', board: a.board, target: a.target, id: a.id })
    // a row selects what every selected row names; the session mirrors it into the editor
    if (a.kind === 'ref') preview.post({ type: 'pcbjs:select', board: a.board, target: a.target, refs: sidebar.selectedRefs(a.board, a.ref), frame: true, by: 'tree' })
    else if (a.source) await selectRange(a.source)
  }

  shutdown = async () => {
    closing = true
    lifetime.abort()
    discovery++
    boardTicket++
    clearTimeout(iconTimer)
    const old = wiring
    wiring = undefined
    server = undefined
    await old?.dispose()
  }

  async function offerWalkthrough(): Promise<void> {
    if (commanded || projectDirs.length || !vscode.workspace.workspaceFolders?.length || context.globalState.get(WALKTHROUGH_SHOWN)) return
    await context.globalState.update(WALKTHROUGH_SHOWN, true)
    await openWalkthrough()
  }

  function openWalkthrough(): Thenable<unknown> {
    return vscode.commands.executeCommand('workbench.action.openWalkthrough', `${context.extension.id}#${WALKTHROUGH}`, false)
  }

  updateStatus()
  void discover().then(offerWalkthrough)
}

export function deactivate(): Promise<void> | undefined {
  const fn = shutdown
  shutdown = undefined
  return fn?.()
}

const OPEN_COMMANDS: Record<OpenMode, Record<ViewName, string>> = {
  reuse: { '2d': 'pcbjs.open2D', '3d': 'pcbjs.open3D', sch: 'pcbjs.openSchematic', checks: 'pcbjs.openChecks' },
  beside: { '2d': 'pcbjs.open2DBeside', '3d': 'pcbjs.open3DBeside', sch: 'pcbjs.openSchematicBeside', checks: 'pcbjs.openChecksBeside' },
  new: { '2d': 'pcbjs.open2DNew', '3d': 'pcbjs.open3DNew', sch: 'pcbjs.openSchematicNew', checks: 'pcbjs.openChecksNew' },
}
const VIEW_ICONS: Record<ViewName, string> = { '2d': 'circuit-board', '3d': 'package', sch: 'type-hierarchy-sub', checks: 'checklist' }

/** The setting, else `node` on PATH, else the usual install locations. */
function findNode(setting: string): string {
  if (setting) return setting
  const exe = process.platform === 'win32' ? 'node.exe' : 'node'
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  if (process.platform !== 'win32') dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin')
  for (const d of dirs) {
    const p = path.join(d, exe)
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {}
  }
  return exe
}
