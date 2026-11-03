// A fake of the vscode API the panels and the sidebar use, installed as the module `vscode` for require.
import Module from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'

class EventEmitter {
  listeners = new Set()
  event = cb => {
    this.listeners.add(cb)
    return { dispose: () => this.listeners.delete(cb) }
  }
  fire(v) {
    for (const cb of [...this.listeners]) cb(v)
  }
  dispose() {
    this.listeners.clear()
  }
}

const uri = s => ({ scheme: new URL(s).protocol.slice(0, -1), fsPath: s.startsWith('file:') ? fileURLToPath(s) : '', toString: () => s })

/** Every panel created, with what was posted to it. */
export const panels = []

const BESIDE = -2
export const tabEvents = new EventEmitter()
/** The focused editor group; a test sets it to put the cursor in the code or in a pane. */
export const tabGroups = { activeTabGroup: { viewColumn: 1 }, all: [], close: async tab => closeTab(tab), onDidChangeTabs: tabEvents.event }

class TabInputText {
  constructor(uri) {
    this.uri = uri
  }
}
class TabInputWebview {
  constructor(viewType) {
    this.viewType = viewType
  }
}

/** The editor layout behind tabGroups.all: groups in grid order, each with its tabs; every call the fake answers is logged. */
export const layout = { orientation: 0, calls: [], shows: [] }

const renumber = () => tabGroups.all.forEach((g, i) => (g.viewColumn = i + 1))

/** A group of tabs, each a file path or `pane`; the last tab is the active one. */
export function group(...tabs) {
  const g = { viewColumn: 0, tabs: [], activeTab: undefined }
  for (const t of tabs) addTab(g, t === 'pane' ? new TabInputWebview('mainThreadWebview-pcbjs.preview') : new TabInputText(vscode.Uri.file(t)))
  return g
}

function addTab(g, input) {
  const tab = { input, group: g, isPreview: false }
  g.tabs.push(tab)
  g.activeTab = tab
  return tab
}

/** Set the groups and focus one by its index. */
export function setGroups(groups, active = 0) {
  tabGroups.all = groups
  renumber()
  tabGroups.activeTabGroup = groups[active]
}

function closeTab(tab) {
  layout.calls.push(['close', tab.input.uri?.fsPath])
  const g = tab.group
  g.tabs = g.tabs.filter(t => t !== tab)
  if (g.activeTab === tab) g.activeTab = g.tabs.at(-1)
  tabEvents.fire({ closed: [tab], opened: [], changed: [] })
  return true
}

function newGroup(before) {
  const g = group()
  tabGroups.all.splice(tabGroups.all.indexOf(tabGroups.activeTabGroup) + (before ? 0 : 1), 0, g)
  renumber()
  tabGroups.activeTabGroup = g
}

async function showTextDocument(doc, opts = {}) {
  if (!doc.uri) doc = await openTextDocument(doc)
  layout.calls.push(['show', opts.viewColumn, opts.preserveFocus])
  layout.shows.push({ uri: doc.uri.toString(), ...opts })
  const g = tabGroups.all.find(x => x.viewColumn === (opts.viewColumn ?? tabGroups.activeTabGroup.viewColumn))
  if (!g) return { document: doc, viewColumn: opts.viewColumn, selection: opts.selection }
  let tab = g.tabs.find(t => t.input.uri?.toString() === doc.uri.toString())
  if (!tab) {
    if (opts.preview && !doc.isDirty) g.tabs = g.tabs.filter(t => !t.isPreview)
    tab = addTab(g, new TabInputText(doc.uri))
    tab.isPreview = !!opts.preview && !doc.isDirty
  } else if (opts.preview === false || doc.isDirty) tab.isPreview = false
  g.activeTab = tab
  if (!opts.preserveFocus) tabGroups.activeTabGroup = g
  return {
    document: doc,
    viewColumn: g.viewColumn,
    selection: undefined,
    revealed: undefined,
    revealRange(r) {
      this.revealed = r
    },
  }
}

class Position {
  constructor(line, character) {
    this.line = line
    this.character = character
  }
}

const before = (a, b) => a.line < b.line || (a.line === b.line && a.character <= b.character)

class Range {
  constructor(a, b, c, d) {
    ;[this.start, this.end] = typeof a === 'number' ? [new Position(a, b), new Position(c, d)] : [a, b]
  }
}

class Selection extends Range {
  constructor(anchor, active) {
    super(...(before(anchor, active) ? [anchor, active] : [active, anchor]))
    this.anchor = anchor
    this.active = active
  }
}

class WorkspaceEdit {
  edits = []
  replace(uri, range, newText) {
    this.edits.push({ uri, range, newText })
  }
}

const docEvents = { open: new EventEmitter(), save: new EventEmitter(), change: new EventEmitter(), close: new EventEmitter() }

/** An open document: its text, dirty until saved or reverted to the file. */
export class FakeDoc {
  constructor(file, text, dirty = false) {
    this.uri = vscode.Uri.file(file)
    this.text = text
    this.isDirty = dirty
  }
  getText() {
    return this.text
  }
  offsetAt(p) {
    const lines = this.text.split('\n')
    if (p.line >= lines.length) return this.text.length
    return lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + Math.min(p.character, lines[p.line].length)
  }
  validatePosition(p) {
    return this.positionAt(this.offsetAt(p))
  }
  positionAt(o) {
    const head = this.text.slice(0, o).split('\n')
    return new Position(head.length - 1, head[head.length - 1].length)
  }
  /** written to its file, clean */
  async save() {
    writeFileSync(this.uri.fsPath, this.text)
    this.isDirty = false
    docEvents.save.fire(this)
    return true
  }
  /** a keystroke: the text changes and the buffer is dirty */
  type(text) {
    this.text = text
    this.isDirty = true
    docEvents.change.fire({ document: this })
  }
}

/** The documents open in the fake editor, the editors showing them, every command run with its arguments. */
export const docs = []
export const editors = []
export const commands = []
export const commandHandlers = new Map()
export const linkProviders = new Map()

export function openDoc(file, text, opts = {}) {
  const doc = new FakeDoc(file, text, opts.dirty)
  docs.push(doc)
  docEvents.open.fire(doc)
  const editor = { document: doc, selections: opts.selections ?? [new Selection(new Position(0, 0), new Position(0, 0))], viewColumn: 1 }
  if (opts.visible !== false) editors.push(editor)
  return { doc, editor }
}

/** The open document of the file, else one read from disk and opened. */
async function openTextDocument(u) {
  const open = docs.find(d => d.uri.toString() === u.toString())
  if (open) return open
  const provider = contentProviders[u.scheme]
  const doc = new FakeDoc(u.fsPath || '/virtual.json', provider ? await provider.provideTextDocumentContent(u) : readFileSync(u.fsPath, 'utf8'))
  if (provider) doc.uri = u
  docs.push(doc)
  docEvents.open.fire(doc)
  return doc
}

async function applyEdit(edit) {
  for (const doc of docs) {
    const mine = edit.edits.filter(e => e.uri.toString() === doc.uri.toString())
    if (!mine.length) continue
    history.done.push({ doc, text: doc.text })
    history.undone.length = 0
    for (const e of [...mine].sort((a, b) => doc.offsetAt(b.range.start) - doc.offsetAt(a.range.start)))
      doc.text = doc.text.slice(0, doc.offsetAt(e.range.start)) + e.newText + doc.text.slice(doc.offsetAt(e.range.end))
    doc.isDirty = true
    docEvents.change.fire({ document: doc })
  }
  return true
}

/** Each applyEdit's document and its text before, which `undo` and `redo` take back and forth. */
const history = { done: [], undone: [] }

async function executeCommand(id, ...args) {
  if (commandHandlers.has(id)) return commandHandlers.get(id)(...args)
  layout.calls.push([id])
  commands.push([id, ...args])
  if (id === 'undo' || id === 'redo') {
    const step = (id === 'undo' ? history.done : history.undone).pop()
    if (step) {
      ;(id === 'undo' ? history.undone : history.done).push({ doc: step.doc, text: step.doc.text })
      step.doc.text = step.text
      docEvents.change.fire({ document: step.doc })
    }
  }
  if (id === 'workbench.action.files.revert') {
    const doc = docs.find(d => d.uri.toString() === args[0]?.toString())
    if (doc) {
      doc.text = readFileSync(doc.uri.fsPath, 'utf8')
      doc.isDirty = false
      docEvents.change.fire({ document: doc })
    }
  }
  if (id === 'vscode.getEditorLayout') return { orientation: layout.orientation, groups: tabGroups.all.map(() => ({})) }
  if (id === 'workbench.action.newGroupLeft') newGroup(true)
  if (id === 'workbench.action.newGroupAbove') newGroup(true)
  return undefined
}

function createWebviewPanel(viewType, title, show, options) {
  const disposed = new EventEmitter()
  const viewState = new EventEmitter()
  const received = new EventEmitter()
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
    webview: { html: '', options: {}, postMessage: async m => (panel.posted.push(m), true), onDidReceiveMessage: received.event, receive: m => received.fire(m) },
    reveal(column, preserveFocus) {
      panel.revealed++
      if (!preserveFocus) panel.focus()
    },
    focus() {
      for (const p of panels) p.active = p === panel
      tabGroups.activeTabGroup.viewColumn = panel.viewColumn
      viewState.fire({ webviewPanel: panel })
    },
    onDidDispose: disposed.event,
    onDidChangeViewState: viewState.event,
    dispose() {
      if (panel.disposed) return
      panel.disposed = true
      disposed.fire()
    },
  }
  panels.push(panel)
  return panel
}

/** The dialogs of the setup commands: a test queues one answer per call by kind, a value or a function of the call; none answers undefined. */
export const ui = { answers: [], calls: [], folders: [], files: [], clipboard: [], opened: [] }

function answer(kind, call) {
  ui.calls.push({ kind, ...call })
  const i = ui.answers.findIndex(a => a[0] === kind)
  if (i < 0) return undefined
  const [[, a]] = ui.answers.splice(i, 1)
  return typeof a === 'function' ? a(call) : a
}

const QuickInputButtons = { Back: { id: 'back' } }

/** A quick pick answered by kind quickPick: an item, 'active' for Enter on the active one, 'back' for the Back button, undefined for Escape. */
function createQuickPick() {
  const accepted = new EventEmitter()
  const hidden = new EventEmitter()
  const button = new EventEmitter()
  const qp = {
    items: [],
    activeItems: [],
    selectedItems: [],
    buttons: [],
    placeholder: '',
    onDidAccept: accepted.event,
    onDidHide: hidden.event,
    onDidTriggerButton: button.event,
    show() {
      queueMicrotask(() => {
        const { items, activeItems: active, placeholder, title, step, totalSteps, buttons } = qp
        const pick = answer('quickPick', { items, active, placeholder, title, step, totalSteps, buttons })
        if (pick === undefined) return qp.hide()
        if (pick === 'back') return button.fire(QuickInputButtons.Back)
        if (pick !== 'active') qp.selectedItems = [pick]
        accepted.fire()
      })
    },
    hide: () => hidden.fire(),
    dispose() {},
  }
  return qp
}

/** An input box answered by kind inputBox: 'accept' for Enter on the prefilled value, a string typed then Enter, 'back', or undefined for Escape. */
function createInputBox() {
  const accepted = new EventEmitter()
  const hidden = new EventEmitter()
  const button = new EventEmitter()
  const changed = new EventEmitter()
  const box = {
    value: '',
    prompt: '',
    buttons: [],
    validationMessage: undefined,
    onDidAccept: accepted.event,
    onDidHide: hidden.event,
    onDidTriggerButton: button.event,
    onDidChangeValue: changed.event,
    show() {
      queueMicrotask(() => {
        const { value, prompt, title, step, totalSteps, buttons, validationMessage } = box
        const a = answer('inputBox', { value, prompt, title, step, totalSteps, buttons, validationMessage })
        if (a === undefined) return box.hide()
        if (a === 'back') return button.fire(QuickInputButtons.Back)
        if (a !== 'accept') {
          box.value = a
          changed.fire(a)
        }
        accepted.fire()
      })
    },
    hide: () => hidden.fire(),
    dispose() {},
  }
  return box
}

/** The providers of virtual documents by scheme, as the merge editor reads them. */
export const contentProviders = {}

/** Every terminal created, with the text sent to it. */
export const terminals = []

const workspace = {
  openTextDocument,
  get workspaceFolders() {
    return ui.folders.map((f, index) => ({ uri: vscode.Uri.file(f), name: f.split('/').pop(), index }))
  },
  findFiles: async (glob, exclude) => (ui.calls.push({ kind: 'findFiles', glob, exclude }), ui.files.map(f => vscode.Uri.file(f))),
  get textDocuments() {
    return docs
  },
  onDidOpenTextDocument: docEvents.open.event,
  onDidSaveTextDocument: docEvents.save.event,
  onDidChangeTextDocument: docEvents.change.event,
  onDidCloseTextDocument: docEvents.close.event,
  registerTextDocumentContentProvider: (scheme, provider) => ((contentProviders[scheme] = provider), { dispose: () => delete contentProviders[scheme] }),
  applyEdit,
  getConfiguration: () => ({ get: (_key, fallback) => ui.autoSave ?? fallback }),
  asRelativePath: p => {
    const root = ui.folders.find(f => p.startsWith(`${f}/`))
    return root ? p.slice(root.length + 1) : p
  },
}

export const vscode = {
  languages: {
    registerCodeActionsProvider: () => ({ dispose() {} }),
    registerDocumentLinkProvider: (selector, provider) => (linkProviders.set(selector.scheme, provider), { dispose: () => linkProviders.delete(selector.scheme) }),
  },
  DocumentLink: class { constructor(range, target) { this.range = range; this.target = target } },
  CodeActionKind: { Empty: '' },
  EventEmitter,
  Uri: { parse: uri, from: parts => ({ ...parts, toString: () => `${parts.scheme}:${parts.path}?${encodeURIComponent(parts.query)}` }), file: p => uri(pathToFileURL(p).toString()), joinPath: (u, ...p) => uri(`${u}/${p.join('/')}`) },
  ViewColumn: { Active: -1, One: 1, Beside: BESIDE },
  TabInputText,
  TabInputWebview,
  TextEditorRevealType: { InCenter: 2 },
  QuickInputButtons,
  Position,
  Range,
  Selection,
  WorkspaceEdit,
  ThemeColor: class {
    constructor(id) {
      this.id = id
    }
  },
  ThemeIcon: class {
    constructor(id, color) {
      this.id = id
      this.color = color
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label
      this.collapsibleState = collapsibleState
    }
  },

  window: {
    activeColorTheme: { kind: 2 },
    onDidChangeActiveColorTheme: new EventEmitter().event,
    createWebviewPanel,
    tabGroups,
    showTextDocument,
    createTreeView: (id, opts) => ({ id, ...opts, description: undefined, dispose() {}, onDidChangeSelection() {}, onDidExpandElement() {}, onDidCollapseElement() {} }),
    createTextEditorDecorationType: () => ({ dispose() {} }),
    onDidChangeVisibleTextEditors: new EventEmitter().event,
    get visibleTextEditors() {
      return editors
    },
    get activeTextEditor() {
      return editors[0]
    },
    setStatusBarMessage: text => (ui.calls.push({ kind: 'status', text }), { dispose() {} }),
    createQuickPick,
    createInputBox,
    createTerminal: opts => {
      const t = { ...opts, sent: [], shown: 0, show: () => t.shown++, sendText: text => t.sent.push(text) }
      terminals.push(t)
      return t
    },
    showQuickPick: async (items, opts) => answer('pick', { items, ...opts }),
    showInputBox: async opts => answer('input', opts),
    showOpenDialog: async opts => answer('open', opts),
    showInformationMessage: async (text, ...actions) => answer('info', { text, actions }),
    showWarningMessage: async (text, ...actions) => answer('warning', { text, actions }),
    showErrorMessage: async (text, ...actions) => answer('error', { text, actions }),
    withProgress: async (opts, task) => {
      const reported = []
      ui.calls.push({ kind: 'progress', title: opts.title, reported })
      return task({ report: r => reported.push(r.message) }, { onCancellationRequested() {} })
    },
  },
  workspace,
  ProgressLocation: { Notification: 15 },
  env: { asExternalUri: async u => u, clipboard: { writeText: async t => ui.clipboard.push(t) } },
  commands: { executeCommand, registerCommand: (id, handler) => (commandHandlers.set(id, handler), { dispose: () => commandHandlers.delete(id) }) },
}

const load = Module._load
Module._load = function (request, ...rest) {
  return request === 'vscode' ? vscode : load.call(this, request, ...rest)
}
