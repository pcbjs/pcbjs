// A fake of the vscode API the panels and the sidebar use, installed as the module `vscode` for require.
import Module from 'node:module';
import { pathToFileURL } from 'node:url';

class EventEmitter {
  listeners = new Set();
  event = (cb) => {
    this.listeners.add(cb);
    return { dispose: () => this.listeners.delete(cb) };
  };
  fire(v) {
    for (const cb of [...this.listeners]) cb(v);
  }
  dispose() {
    this.listeners.clear();
  }
}

const uri = (s) => ({ scheme: new URL(s).protocol.slice(0, -1), fsPath: s.startsWith('file:') ? decodeURIComponent(new URL(s).pathname) : '', toString: () => s });

/** Every panel created, with what was posted to it. */
export const panels = [];

const BESIDE = -2;
/** The focused editor group; a test sets it to put the cursor in the code or in a pane. */
export const tabGroups = { activeTabGroup: { viewColumn: 1 }, all: [], close: async (tab) => closeTab(tab) };

class TabInputText {
  constructor(uri) {
    this.uri = uri;
  }
}
class TabInputWebview {
  constructor(viewType) {
    this.viewType = viewType;
  }
}

/** The editor layout behind tabGroups.all: groups in grid order, each with its tabs; every call the fake answers is logged. */
export const layout = { orientation: 0, calls: [] };

const renumber = () => tabGroups.all.forEach((g, i) => (g.viewColumn = i + 1));

/** A group of tabs, each a file path or `pane`; the last tab is the active one. */
export function group(...tabs) {
  const g = { viewColumn: 0, tabs: [], activeTab: undefined };
  for (const t of tabs) addTab(g, t === 'pane' ? new TabInputWebview('mainThreadWebview-pcbjs.preview') : new TabInputText(vscode.Uri.file(t)));
  return g;
}

function addTab(g, input) {
  const tab = { input, group: g };
  g.tabs.push(tab);
  g.activeTab = tab;
  return tab;
}

/** Set the groups and focus one by its index. */
export function setGroups(groups, active = 0) {
  tabGroups.all = groups;
  renumber();
  tabGroups.activeTabGroup = groups[active];
}

function closeTab(tab) {
  layout.calls.push(['close', tab.input.uri?.fsPath]);
  const g = tab.group;
  g.tabs = g.tabs.filter((t) => t !== tab);
  if (g.activeTab === tab) g.activeTab = g.tabs.at(-1);
  return true;
}

function newGroup(before) {
  const g = group();
  tabGroups.all.splice(tabGroups.all.indexOf(tabGroups.activeTabGroup) + (before ? 0 : 1), 0, g);
  renumber();
  tabGroups.activeTabGroup = g;
}

async function showTextDocument(doc, opts) {
  layout.calls.push(['show', opts.viewColumn, opts.preserveFocus]);
  const g = tabGroups.all.find((x) => x.viewColumn === opts.viewColumn);
  const tab = g.tabs.find((t) => t.input.uri?.toString() === doc.uri.toString()) ?? addTab(g, new TabInputText(doc.uri));
  g.activeTab = tab;
  if (!opts.preserveFocus) tabGroups.activeTabGroup = g;
  return { document: doc, viewColumn: g.viewColumn, selection: undefined, revealed: undefined, revealRange(r) {
    this.revealed = r;
  } };
}

async function executeCommand(id) {
  layout.calls.push([id]);
  if (id === 'vscode.getEditorLayout') return { orientation: layout.orientation, groups: tabGroups.all.map(() => ({})) };
  if (id === 'workbench.action.newGroupLeft') newGroup(true);
  if (id === 'workbench.action.newGroupAbove') newGroup(true);
  return undefined;
}

function createWebviewPanel(viewType, title, show, options) {
  const disposed = new EventEmitter();
  const viewState = new EventEmitter();
  const received = new EventEmitter();
  const panel = {
    viewType,
    title,
    options,
    viewColumn: show.viewColumn === BESIDE ? tabGroups.activeTabGroup.viewColumn + 1 : (show.viewColumn ?? tabGroups.activeTabGroup.viewColumn),
    revealed: 0,
    active: false,
    disposed: false,
    posted: [],
    iconPath: undefined,
    webview: { html: '', options: {}, postMessage: async (m) => (panel.posted.push(m), true), onDidReceiveMessage: received.event },
    reveal(column, preserveFocus) {
      panel.revealed++;
      if (!preserveFocus) panel.focus();
    },
    focus() {
      for (const p of panels) p.active = p === panel;
      tabGroups.activeTabGroup.viewColumn = panel.viewColumn;
      viewState.fire({ webviewPanel: panel });
    },
    onDidDispose: disposed.event,
    onDidChangeViewState: viewState.event,
    dispose() {
      if (panel.disposed) return;
      panel.disposed = true;
      disposed.fire();
    },
  };
  panels.push(panel);
  return panel;
}

/** The dialogs of the setup commands: a test queues one answer per call by kind, a value or a function of the call; none answers undefined. */
export const ui = { answers: [], calls: [], folders: [], files: [], clipboard: [], opened: [] };

function answer(kind, call) {
  ui.calls.push({ kind, ...call });
  const i = ui.answers.findIndex((a) => a[0] === kind);
  if (i < 0) return undefined;
  const [[, a]] = ui.answers.splice(i, 1);
  return typeof a === 'function' ? a(call) : a;
}

function createQuickPick() {
  const accepted = new EventEmitter();
  const hidden = new EventEmitter();
  const qp = {
    items: [],
    activeItems: [],
    selectedItems: [],
    placeholder: '',
    onDidAccept: accepted.event,
    onDidHide: hidden.event,
    show() {
      queueMicrotask(() => {
        const pick = answer('quickPick', { items: qp.items, active: qp.activeItems, placeholder: qp.placeholder });
        if (pick === undefined) return qp.hide();
        if (pick !== 'active') qp.selectedItems = [pick];
        accepted.fire();
      });
    },
    hide: () => hidden.fire(),
    dispose() {},
  };
  return qp;
}

const workspace = {
  get workspaceFolders() {
    return ui.folders.map((f, index) => ({ uri: vscode.Uri.file(f), name: f.split('/').pop(), index }));
  },
  findFiles: async (glob, exclude) => (ui.calls.push({ kind: 'findFiles', glob, exclude }), ui.files.map((f) => vscode.Uri.file(f))),
  asRelativePath: (p) => {
    const root = ui.folders.find((f) => p.startsWith(`${f}/`));
    return root ? p.slice(root.length + 1) : p;
  },
};

export const vscode = {
  EventEmitter,
  Uri: { parse: uri, file: (p) => uri(pathToFileURL(p).toString()), joinPath: (u, ...p) => uri(`${u}/${p.join('/')}`) },
  ViewColumn: { One: 1, Beside: BESIDE },
  TabInputText,
  TabInputWebview,
  TextEditorRevealType: { InCenter: 2 },
  Selection: class {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  ThemeColor: class {
    constructor(id) {
      this.id = id;
    }
  },
  ThemeIcon: class {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },

  window: {
    activeColorTheme: { kind: 2 },
    onDidChangeActiveColorTheme: new EventEmitter().event,
    createWebviewPanel,
    tabGroups,
    showTextDocument,
    createTreeView: (id, opts) => ({ id, ...opts, description: undefined, dispose() {} }),
    createQuickPick,
    showQuickPick: async (items, opts) => answer('pick', { items, ...opts }),
    showInputBox: async (opts) => answer('input', opts),
    showOpenDialog: async (opts) => answer('open', opts),
    showInformationMessage: async (text, ...actions) => answer('info', { text, actions }),
    showWarningMessage: async (text, ...actions) => answer('warning', { text, actions }),
    showErrorMessage: async (text, ...actions) => answer('error', { text, actions }),
    withProgress: async (opts, task) => {
      const reported = [];
      ui.calls.push({ kind: 'progress', title: opts.title, reported });
      return task({ report: (r) => reported.push(r.message) }, { onCancellationRequested() {} });
    },
  },
  workspace,
  ProgressLocation: { Notification: 15 },
  env: { asExternalUri: async (u) => u, clipboard: { writeText: async (t) => ui.clipboard.push(t) } },
  commands: { executeCommand },
};

const load = Module._load;
Module._load = function (request, ...rest) {
  return request === 'vscode' ? vscode : load.call(this, request, ...rest);
};
