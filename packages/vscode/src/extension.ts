import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IdeHost, HostedClient } from './host';
import { PcbjsServer, INSTALL_HINT, LOCAL_BINS } from './server';
import { Sync, SyncTarget } from './sync';
import { PANEL_TYPE, Preview, savedView, type OpenMode } from './preview';
import { Sidebar } from './sidebar';
import { reveal } from './reveal';
import type { Action, Node } from './tree-data';
import { VIEWS, VIEW_NAMES, shownBoard, type Board, type ViewKind } from './views';
import { FallbackBridge } from './fallback';
import { SegmentsUi } from './segments-ui';
import { startLanguage, type LanguageLink } from './language';
import { IconThemeFile, associateIcons, findEntries, iconEnv, workspaceEnv } from './icons';
import { autoIcons, revokeIcons } from './auto-icons';
import type { EditorPort, Range } from './lsp-client';
import { ReadyInfo, SelectRequest, isUnder, offers, samePath } from './protocol';
import { convertKicad, createProject, installSkills, type SetupHost } from './setup';

const CONFIG_GLOB = '**/{pcb,pcbjs}.config.{ts,mts,js,mjs}';

let shutdown: (() => Promise<void>) | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('pcbjs');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'pcbjs.pickView';
  const config = (scope?: vscode.Uri) => vscode.workspace.getConfiguration('pcbjs', scope);
  const version = String(context.extension.packageJSON.version ?? '0.0.0');
  /** at most one, keyed by the folders */
  const servers = new Map<string, PcbjsServer>();
  let projectDirs: string[] = [];
  /** the group a jump to source prefers when it has a choice */
  let editorColumn: vscode.ViewColumn | undefined = vscode.window.activeTextEditor?.viewColumn;
  let refreshQueued = false;
  /** the last design file in focus and the board the viewers show for it */
  let activeFile = vscode.window.activeTextEditor?.document.uri.scheme === 'file' ? vscode.window.activeTextEditor.document.uri.fsPath : undefined;
  let shown: string | undefined;
  let pinnedNet: string | undefined;
  const noticed = new Set<string>();
  /** One notice per text and session. */
  const notice = (text: string, ...actions: string[]) => {
    if (noticed.has(text)) return Promise.resolve(undefined);
    noticed.add(text);
    output.appendLine(text);
    return vscode.window.showWarningMessage(text, ...actions);
  };

  const host = new IdeHost({
    name: 'vscode-pcbjs',
    version,
    editor: { select: (req) => selectRange(req), log: (m) => output.appendLine(`[ide] ${m}`) },
    target: (info: ReadyInfo) => findOwner(info),
    onConnect: (client: HostedClient) => {
      if (!client.root) return;
      if (!links.has(client) && client.info && offers(client.info, 'lsp')) void startLink(client);
      resync((file) => host.route(file) === client);
    },
    onChange: () => refresh(),
    onTooNew: (text) => void notice(`pcbjs: ${text}`),
  });
  const listening = host.listen().catch((err) => {
    output.appendLine(`cannot start the IDE host: ${err.message}`);
    throw err;
  });
  listening.catch(() => undefined);

  const links = new Map<HostedClient, LanguageLink | null>();
  const port = (client: HostedClient): EditorPort => ({
    select: (uri, range) => selectUri(uri, range),
    preview: (url) => {
      const server = client.info && findOwner(client.info);
      if (!server) return;
      server.previewUrl = url;
      preview.follow(server, url);
    },
    applyEdit: async (uri, edits) => {
      const edit = new vscode.WorkspaceEdit();
      for (const e of edits) edit.replace(vscode.Uri.parse(uri), new vscode.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText);
      return vscode.workspace.applyEdit(edit);
    },
    uri: (file) => vscode.Uri.file(file).toString(),
  });
  async function startLink(client: HostedClient): Promise<void> {
    links.set(client, null);
    const server = client.info && findOwner(client.info);
    const folders = server ? server.folders : client.info?.folders ?? (client.root ? [client.root] : []);
    const link = await startLanguage(client, folders, version, output, port(client));
    if (!client.open) {
      void link?.dispose();
      links.delete(client);
      return;
    }
    links.set(client, link ?? null);
    client.onClose(() => {
      links.delete(client);
      segmentsUi.refresh();
    });
    segmentsUi.refresh();
    resync((file) => host.route(file) === client);
  }

  /** Send the active file and cursor again, to whichever server takes them. */
  function resync(accepts: (file: string) => boolean = () => true): void {
    sync.resetFocus();
    const ed = vscode.window.activeTextEditor;
    if (ed && ed.document.uri.scheme === 'file' && accepts(ed.document.uri.fsPath)) {
      sync.focus(ed.document.uri.fsPath, true);
      reportCursor(ed);
    }
  }
  const sessionOf = (file: string) => {
    const c = host.route(file);
    const link = c && links.get(c);
    return link?.running ? link.session : undefined;
  };

  const sync = new Sync({
    route: (file): SyncTarget | undefined => {
      const c = host.route(file);
      if (c?.root) {
        const link = links.get(c);
        return { root: c.root, send: (e, d) => (link?.running && link.session.relay(e, d)) || c.send(e, d) };
      }
      return fallback.route(file);
    },
  });
  const readSyncSettings = () => {
    sync.cursorSync = config().get<boolean>('cursorSync', true);
    sync.followFocus = config().get<boolean>('followFocus', true);
  };
  readSyncSettings();

  const fallback = new FallbackBridge({
    version,
    output,
    onTooNew: (text) => void notice(`pcbjs: ${text}`),
    isHosted: (info) => [...servers.values()].some((s) => s.covers(info)),
    select: (req) => selectRange(req),
    onChange: () => refresh(),
  });

  const boardOf = (server: PcbjsServer): Board | undefined => shownBoard(server.boards, shown, activeFile, server.root);
  const preview = new Preview({
    ensureStarted: (s) => startWithProgress(s),
    board: boardOf,
    lastView: { get: () => context.globalState.get<ViewKind>('pcbjs.lastView'), set: (v) => void context.globalState.update('pcbjs.lastView', v) },
    externalUrl: (root) => {
      const c = fallback.forRoot(root);
      if (!c) return undefined;
      return c.info.url ?? c.info.urls?.find((u) => /^https?:/.test(u)) ?? `http://localhost:${c.info.port}/`;
    },
    onChange: () => refresh(),
    icon: { light: vscode.Uri.joinPath(context.extensionUri, 'assets', 'icons', 'light', 'preview.svg'), dark: vscode.Uri.joinPath(context.extensionUri, 'assets', 'icons', 'dark', 'preview.svg') },
  });

  const sidebar = new Sidebar();

  const iconFile = new IconThemeFile(context.extensionPath);
  const icons = iconEnv(context);
  void autoIcons(icons);
  let iconTimer: NodeJS.Timeout | undefined;
  const refreshIcons = () => {
    clearTimeout(iconTimer);
    iconTimer = setTimeout(() => {
      void iconFile.refresh(projectDirs);
      void findEntries(projectDirs).then((e) => vscode.commands.executeCommand('setContext', 'pcbjs.entries', e));
    }, 300);
  };
  const iconWatchers = [CONFIG_GLOB, '**/.pcbjs/fab/*/*.zip'].map((g) => vscode.workspace.createFileSystemWatcher(g));
  for (const w of iconWatchers) for (const on of [w.onDidCreate, w.onDidChange, w.onDidDelete]) context.subscriptions.push(on(refreshIcons));

  const segmentsUi = new SegmentsUi((doc) => (doc.uri.scheme === 'file' ? sessionOf(doc.uri.fsPath) : undefined));

  function findOwner(info: ReadyInfo): PcbjsServer | undefined {
    const all = [...servers.values()];
    return all.find((s) => s.pid !== undefined && s.pid === info.pid) ?? all.find((s) => samePath(s.root, info.root));
  }

  function makeServer(folders: string[]): PcbjsServer {
    const uri = vscode.Uri.file(folders[0]);
    const server: PcbjsServer = new PcbjsServer({
      folders: () => folders,
      candidates: () => projectDirs,
      ideUrl: () => listening,
      nodePath: () => findNode(config(uri).get<string>('nodePath', '')),
      output: (line) => output.appendLine(line),
      onGlobal: (bin) =>
        void notice(`pcbjs: no project in this workspace has pcbjs installed, so the global ${bin} runs, whatever its version. Run \`${INSTALL_HINT}\` in the project so it runs its own.`, 'Copy command').then((a) => {
          if (a) void vscode.env.clipboard.writeText(INSTALL_HINT);
        }),
      onScope: (scope) => preview.follow(server, scope.url),
      onChange: () => {
        const was = lastKind.get(server);
        lastKind.set(server, server.state.kind);
        if (server.state.kind === 'failed' && was !== 'failed') notifyFailure(server);
        if ((was === 'stopped' || was === 'failed' || was === undefined) !== !server.active) void fallback.scan();
        refresh();
      },
    });
    return server;
  }
  const lastKind = new WeakMap<PcbjsServer, string>();

  /** One server for every folder, when any holds a config or a pcbjs; the configs found only say where pcbjs may be installed. */
  async function discover(): Promise<void> {
    const folders: string[] = [];
    const dirs = new Set<string>();
    let any = false;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue;
      folders.push(folder.uri.fsPath);
      const configs = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, CONFIG_GLOB), '**/node_modules/**');
      for (const c of configs) dirs.add(path.dirname(c.fsPath));
      if (configs.length || LOCAL_BINS.some((b) => fs.existsSync(path.join(folder.uri.fsPath, b)))) any = true;
    }
    projectDirs = [...dirs];
    refreshIcons();
    const key = any ? folders.join('\n') : '';
    for (const [k, s] of servers) {
      if (k === key) continue;
      servers.delete(k);
      void s.stop();
    }
    if (key && !servers.has(key)) servers.set(key, makeServer(folders));
    void vscode.commands.executeCommand('setContext', 'pcbjs.active', servers.size > 0);
    segmentsUi.refresh();
    if (config().get<boolean>('autoStart', false)) for (const s of servers.values()) if (s.state.kind === 'stopped') void s.start();
    refresh();
    const s = current();
    if (s) void preview.resume(s);
  }

  /** The active file's, else the preview's, else the only one. */
  function current(): PcbjsServer | undefined {
    const ed = vscode.window.activeTextEditor;
    if (ed?.document.uri.scheme === 'file') {
      const owner = ownerOf(ed.document.uri.fsPath);
      if (owner) return owner;
    }
    if (preview.server) return preview.server;
    const all = [...servers.values()];
    return all.length === 1 ? all[0] : all.find((s) => s.active);
  }

  function ownerOf(file: string): PcbjsServer | undefined {
    for (const s of servers.values()) {
      if (!s.contains(file)) continue;
      const scopes = s.scopes?.scopes;
      if (!scopes || scopes.some((sc) => isUnder(sc.root, file)) || projectDirs.some((d) => isUnder(d, file))) return s;
    }
    return undefined;
  }

  async function pick(placeHolder: string): Promise<PcbjsServer | undefined> {
    const cur = current();
    if (cur) return cur;
    const all = [...servers.values()];
    if (!all.length) {
      void vscode.window.showWarningMessage(`pcbjs: no pcbjs project in this workspace. A project has a pcb.config.ts, or @pcbjs/pcbjs in node_modules: ${INSTALL_HINT}.`);
      return undefined;
    }
    const chosen = await vscode.window.showQuickPick(
      all.map((s) => ({ label: s.name, description: vscode.workspace.asRelativePath(s.root), detail: s.state.kind, server: s })),
      { placeHolder },
    );
    return chosen?.server;
  }

  async function startWithProgress(server: PcbjsServer): Promise<void> {
    if (server.state.kind === 'running') return;
    if (!server.active) void server.start();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `pcbjs: starting the dev server for ${server.name}`, cancellable: true },
      (_p, token) =>
        new Promise<void>((ok, fail) => {
          token.onCancellationRequested(() => ok());
          server.whenReady().then(() => ok(), fail);
        }),
    );
  }

  function notifyFailure(server: PcbjsServer): void {
    const s = server.state;
    if (s.kind !== 'failed') return;
    if (s.hint === 'install') {
      void vscode.window.showErrorMessage(`pcbjs: pcbjs is not installed for ${server.name}. Run \`${INSTALL_HINT}\` in ${server.root}.`, 'Copy command').then((a) => {
        if (a) void vscode.env.clipboard.writeText(INSTALL_HINT);
      });
    } else if (s.hint === 'node') {
      void vscode.window.showErrorMessage(`pcbjs: ${s.reason}. Set pcbjs.nodePath to a Node 22.12 or newer binary.`, 'Open settings').then((a) => {
        if (a) void vscode.commands.executeCommand('workbench.action.openSettings', 'pcbjs.nodePath');
      });
    } else {
      void vscode.window.showErrorMessage(`pcbjs: ${s.reason}`, 'Show output').then((a) => {
        if (a) output.show(true);
      });
    }
  }

  async function selectRange(req: SelectRequest): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(req.file));
    const start = doc.validatePosition(new vscode.Position(req.line - 1, req.col - 1));
    // endCol 1-based inclusive is endCol 0-based exclusive
    const end = doc.validatePosition(new vscode.Position(req.endLine - 1, req.endCol));
    await reveal(doc, new vscode.Selection(start, end), { last: () => editorColumn, size: (c) => preview.sizeAt(c) });
  }

  function selectUri(uri: string, range: Range): Promise<void> {
    const u = vscode.Uri.parse(uri);
    if (u.scheme !== 'file') return Promise.resolve();
    return selectRange({ file: u.fsPath, line: range.start.line + 1, col: range.start.character + 1, endLine: range.end.line + 1, endCol: Math.max(range.end.character, 1) });
  }

  function reportCursor(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    if (editor.document.uri.scheme !== 'file') {
      sync.leave();
      return;
    }
    const pos = editor.selection.active;
    sync.cursor(editor.document.uri.fsPath, pos.line + 1, pos.character + 1);
  }

  function onActiveEditor(editor: vscode.TextEditor | undefined): void {
    // the preview has focus: the viewer keeps what it shows
    if (!editor) return;
    if (editor.document.uri.scheme !== 'file') {
      reportCursor(editor);
      return;
    }
    if (editor.viewColumn) editorColumn = editor.viewColumn;
    const file = editor.document.uri.fsPath;
    activeFile = file;
    sync.focus(file);
    reportCursor(editor);
    refresh();
  }

  function refresh(): void {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      const server = preview.server ?? current();
      const board = server && boardOf(server);
      if (board) shown = board.name;
      void preview.update();
      void sidebar.update(server, board);
      updateStatus();
    });
  }

  function updateStatus(): void {
    const s = current();
    const external = fallback.connections.filter((c) => c.state === 'connected');
    const cursor = sync.cursorSync ? 'on' : 'off';
    const lines: string[] = [];
    if (!servers.size && !external.length) {
      status.hide();
      return;
    }
    if (s?.state.kind === 'running') status.text = '$(circuit-board) pcbjs';
    else if (s?.state.kind === 'starting') status.text = '$(sync~spin) pcbjs';
    else if (s?.state.kind === 'failed') status.text = '$(error) pcbjs';
    else if (s && fallback.forRoot(s.root)) status.text = '$(plug) pcbjs';
    else status.text = '$(debug-start) pcbjs';
    for (const srv of servers.values()) {
      const st = srv.state;
      const detail = st.kind === 'running' ? `running at ${st.url}${srv.client ? '' : ', reconnecting'}` : st.kind === 'failed' ? `failed: ${st.reason}` : st.kind === 'starting' && st.attempt ? `restarting, attempt ${st.attempt}` : st.kind;
      lines.push(`${srv.name}: ${detail}`);
    }
    for (const c of external) lines.push(`external: ${c.url} for ${c.info.root}`);
    lines.push(`Cursor sync ${cursor}. Click to open a view.`);
    status.tooltip = lines.join('\n');
    status.backgroundColor = s?.state.kind === 'failed' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
    status.show();
  }

  const command = (id: string, fn: () => unknown) => vscode.commands.registerCommand(id, fn);
  context.subscriptions.push(
    output,
    status,
    preview,
    fallback,
    segmentsUi,
    { dispose: () => sync.dispose() },
    vscode.workspace.onDidChangeWorkspaceFolders(() => void discover()),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor === vscode.window.activeTextEditor) reportCursor(e.textEditor);
    }),
    vscode.window.onDidChangeActiveTextEditor(onActiveEditor),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === 'file') sync.close(doc.uri.fsPath);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('pcbjs.cursorSync') || e.affectsConfiguration('pcbjs.followFocus')) {
        readSyncSettings();
        refresh();
      }
      if (e.affectsConfiguration('pcbjs.autoStart')) void discover();
      if (e.affectsConfiguration('workbench.iconTheme')) {
        refreshIcons();
        void autoIcons(icons);
      }
    }),
    command('pcbjs.preview', async () => {
      const s = await pick('Preview which pcbjs project?');
      if (s) await preview.toggle(s);
    }),
    ...VIEWS.flatMap((v) => (Object.keys(OPEN_COMMANDS) as OpenMode[]).map((mode) => command(OPEN_COMMANDS[mode][v], () => openView(v, mode)))),
    command('pcbjs.openAllViews', async () => {
      const s = await pick('Preview which pcbjs project?');
      if (s) await preview.openAll(s);
    }),
    command('pcbjs.pickView', async () => {
      type Item = vscode.QuickPickItem & { view?: ViewKind; mode?: OpenMode };
      const item = (v: ViewKind, mode: OpenMode): Item => ({ label: `$(${VIEW_ICONS[v]}) ${VIEW_NAMES[v]}`, view: v, mode });
      const items: Item[] = [
        ...VIEWS.map((v) => item(v, 'beside')),
        { label: '$(split-horizontal) All three side by side' },
        { label: 'New pane', kind: vscode.QuickPickItemKind.Separator },
        ...VIEWS.map((v) => item(v, 'new')),
      ];
      const chosen = await vscode.window.showQuickPick(items, { placeHolder: 'Open which view of the board?' });
      if (!chosen) return;
      if (chosen.view && chosen.mode) await openView(chosen.view, chosen.mode);
      else await vscode.commands.executeCommand('pcbjs.openAllViews');
    }),
    ...VIEWS.flatMap((v) => [command(BOARD_COMMANDS[v], (node?: Node) => openBoard(node, v, 'reuse')), command(`${BOARD_COMMANDS[v]}New`, (node?: Node) => openBoard(node, v, 'new'))]),
    vscode.commands.registerCommand('pcbjs.sidebar.open', (a: Action) => openAction(a)),
    vscode.window.registerWebviewPanelSerializer(PANEL_TYPE, {
      deserializeWebviewPanel: async (panel, state) => {
        preview.adopt(panel, savedView(state));
        const s = current();
        if (s) await preview.resume(s);
      },
    }),
    sidebar,
    command('pcbjs.start', async () => {
      const s = await pick('Start which pcbjs project?');
      if (s) await startWithProgress(s).catch(() => undefined);
    }),
    command('pcbjs.stop', async () => {
      const s = await pick('Stop which pcbjs project?');
      if (s) await s.stop();
    }),
    command('pcbjs.restart', async () => {
      const s = await pick('Restart which pcbjs project?');
      if (!s) return;
      await s.stop();
      await startWithProgress(s).catch(() => undefined);
    }),
    command('pcbjs.openInBrowser', async () => {
      const s = await pick('Open which pcbjs project?');
      if (!s) return;
      if (s.state.kind !== 'running' && !preview.server) {
        const ext = fallback.forRoot(s.root);
        if (ext) return vscode.env.openExternal(vscode.Uri.parse(ext.info.url ?? ext.info.urls?.[0] ?? `http://localhost:${ext.info.port}/`));
      }
      try {
        await startWithProgress(s);
      } catch {
        return;
      }
      if (s.url) await vscode.env.openExternal(vscode.Uri.parse(s.url));
    }),
    command('pcbjs.preview.reload', async () => {
      const s = preview.server ?? (await pick('Reload the preview of which pcbjs project?'));
      if (!s) return;
      await fallback.scan();
      const external = !s.active && fallback.reconnect(s.root);
      if (!external && !s.active) await startWithProgress(s).catch(() => undefined);
      await preview.reload(s, preview.active);
      resync();
    }),
    command('pcbjs.toggleCursorSync', async () => {
      const next = !config().get<boolean>('cursorSync', true);
      await config().update('cursorSync', next, vscode.ConfigurationTarget.Global);
      sync.cursorSync = next;
      refresh();
      vscode.window.setStatusBarMessage(`pcbjs: cursor sync ${next ? 'on' : 'off'}`, 2000);
    }),
    command('pcbjs.showOutput', () => output.show(true)),
    command('pcbjs.connect', async () => {
      const n = await fallback.connect();
      if (!n) void vscode.window.showInformationMessage('pcbjs: no externally started dev server found.');
    }),
    command('pcbjs.disconnect', () => fallback.disconnect()),
    command('pcbjs.createProject', () => createProject(setup)),
    command('pcbjs.convertKicad', () => convertKicad(setup)),
    command('pcbjs.installSkills', () => installSkills(setup)),
    command('pcbjs.icons.associate', async () => void vscode.window.showInformationMessage(`pcbjs: ${await associateIcons(context.extensionPath, projectDirs)}`)),
    command('pcbjs.icons.revoke', async () => {
      const scopes = vscode.workspace.workspaceFolders?.length ? [icons, workspaceEnv(icons)] : [icons];
      void vscode.window.showInformationMessage(await revokeIcons(icons, scopes));
    }),
    ...iconWatchers,
    { dispose: () => clearTimeout(iconTimer) },
  );

  const setup: SetupHost = {
    output: (line) => output.appendLine(line),
    showOutput: () => output.show(true),
    nodePath: () => findNode(config().get<string>('nodePath', '')),
    projectDirs: () => projectDirs,
    opened: openProject,
  };

  /** Show the board file, add the folder when outside the workspace, and preview it; a running server restarts to find the project. */
  async function openProject(dir: string, file: string): Promise<void> {
    await vscode.window.showTextDocument(vscode.Uri.file(file));
    if (!vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir))) {
      vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri: vscode.Uri.file(dir) });
      return;
    }
    await discover();
    const s = ownerOf(file) ?? current();
    if (!s) return;
    if (s.active && s.scopes && !s.scopes.scopes.some((sc) => samePath(sc.root, dir))) await s.stop();
    await preview.open(s, '2d', 'beside');
  }

  async function openView(view: ViewKind, mode: OpenMode): Promise<void> {
    const s = await pick('Preview which pcbjs project?');
    if (s) await preview.open(s, view, mode);
  }

  async function openBoard(node: Node | undefined, view: ViewKind, mode: OpenMode): Promise<void> {
    const s = current();
    if (!s) return;
    await preview.open(s, view, mode);
    if (node?.action?.kind === 'board') await openAction(node.action);
  }

  async function openAction(a: Action): Promise<void> {
    const server = preview.server ?? current();
    if (a.kind === 'board' || a.kind === 'scope') {
      if (!server) return;
      if (a.kind === 'board') {
        // the pick holds until the next editor focus
        shown = a.name;
        activeFile = undefined;
        await preview.showBoard(server, a.name);
      } else await preview.showScope(server, a.route);
      refresh();
      return;
    }
    if (a.kind === 'net') {
      pinnedNet = pinnedNet === a.net ? undefined : a.net;
      preview.post({ type: 'pcbjs:net', board: a.board, net: pinnedNet ?? null });
      return;
    }
    if (a.kind === 'finding') preview.post({ type: 'pcbjs:finding', board: a.board, at: a.at, layer: a.layer });
    if (a.source) await selectRange(a.source);
  }

  shutdown = async () => {
    await Promise.all([...links.values()].map((l) => l?.dispose()));
    await Promise.all([...servers.values()].map((s) => s.stop()));
    await host.close();
  };

  updateStatus();
  void discover();
}

export function deactivate(): Promise<void> | undefined {
  const fn = shutdown;
  shutdown = undefined;
  return fn?.();
}

const OPEN_COMMANDS: Record<OpenMode, Record<ViewKind, string>> = {
  reuse: { '2d': 'pcbjs.open2D', '3d': 'pcbjs.open3D', sch: 'pcbjs.openSchematic' },
  beside: { '2d': 'pcbjs.open2DBeside', '3d': 'pcbjs.open3DBeside', sch: 'pcbjs.openSchematicBeside' },
  new: { '2d': 'pcbjs.open2DNew', '3d': 'pcbjs.open3DNew', sch: 'pcbjs.openSchematicNew' },
};
const BOARD_COMMANDS: Record<ViewKind, string> = { '2d': 'pcbjs.board.open2D', '3d': 'pcbjs.board.open3D', sch: 'pcbjs.board.openSchematic' };
const VIEW_ICONS: Record<ViewKind, string> = { '2d': 'circuit-board', '3d': 'package', sch: 'type-hierarchy-sub' };

/** The setting, else `node` on PATH, else the usual install locations. */
function findNode(setting: string): string {
  if (setting) return setting;
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  if (process.platform !== 'win32') dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
  for (const d of dirs) {
    const p = path.join(d, exe);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return exe;
}
