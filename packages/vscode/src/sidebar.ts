// The pcbjs view container: Boards with the Worktrees node, Findings, Nets and BOM of the board the viewers show, and Agents.

import * as path from 'node:path'
import { existsSync } from 'node:fs'
import * as vscode from 'vscode'
import type { ScopesMsg } from '@pcbjs/core/protocol'
import type { FacetName } from '@pcbjs/core/site-facets'
import { boardEntries, configFile } from './icons'
import type { SessionLink } from './link'
import { Node, Site, TreeState, boardNodes, boardRow, bomNodes, carryState, findingNodes, netNodes, partNodes, withExpanded } from './tree-data'
import type { Board } from './views'

export const TREES = ['boards', 'findings', 'nets', 'bom', 'agents'] as const
export type Tree = (typeof TREES)[number]

/** A facet as `session/facets` answers it, docs/viewer.md. */
export interface Facet {
  board: string
  target?: string
  facet: string
  hash: string
  data: Record<string, unknown>
}

/** What the trees read of the session that owns the shown board: its link. */
export type Source = Pick<SessionLink, 'boards' | 'scopes' | 'scope' | 'root' | 'request'> & { session?: string }

/** An entry's facets, by its absolute path. */
export type LoadFacets = (link: Source, entry: string) => Promise<Facet[]>

/** What the trees read: the names, parts and nets, the schematic tree, the findings, the BOM, and the code ranges a finding falls back to. */
const WANT: FacetName[] = ['meta', 'sch', 'layers', 'findings', 'fab']

/** The entries each folder's config declares, by root, for the folders whose project is not loaded yet. */
export type Declared = (scopes: ScopesMsg) => Promise<Record<string, string[]>>

const configDeclared: Declared = async scopes => {
  const roots = scopes.scopes.map(s => s.root).filter(r => existsSync(configFile(r)))
  return Object.fromEntries(await Promise.all(roots.map(async r => [r, await boardEntries(r)] as const)))
}

const sessionFacets: LoadFacets = async (link, entry) => (await link.request('session/facets', { entry, facets: WANT })).facets

/** `session/state`'s key of a facet. */
const facetKey = (f: Facet) => `${f.facet}:${f.target === undefined ? f.board : `${f.board}|${f.target}`}`

class Provider implements vscode.TreeDataProvider<Node> {
  constructor(private readonly resolve?: (node: Node) => Promise<void>) {}
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event
  nodes: Node[] = []
  private parents = new Map<string, Node>()
  private byId = new Map<string, Node>()

  set(nodes: Node[]): void {
    this.nodes = nodes
    this.parents.clear()
    this.byId.clear()
    const walk = (ns: Node[], up?: Node) =>
      ns.forEach(n => {
        this.byId.set(n.id, n)
        if (up) this.parents.set(n.id, up)
        walk(n.children ?? [], n)
      })
    walk(nodes)
    this.changed.fire()
  }

  node(id: string): Node | undefined {
    return this.byId.get(id)
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node?.load) {
      await this.resolve?.(node)
      for (const child of node.children ?? []) {
        this.byId.set(child.id, child)
        this.parents.set(child.id, node)
      }
    }
    return node ? (node.children ?? []) : this.nodes
  }

  getParent(node: Node): Node | undefined {
    return this.parents.get(node.id)
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const state = node.children ? (node.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None
    const item = new vscode.TreeItem(node.label, state)
    item.id = node.id
    item.description = node.description
    item.tooltip = node.tooltip
    if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon, ICON_COLORS[node.icon] ? new vscode.ThemeColor(ICON_COLORS[node.icon]) : undefined)
    item.contextValue = node.context ?? (node.action && ROW_CONTEXT.has(node.action.kind) ? node.action.kind : undefined)
    if (node.action) item.command = { command: 'pcbjs.sidebar.open', title: 'Show', arguments: [node.action] }
    return item
  }

  dispose(): void {
    this.changed.dispose()
  }
}

/** the rows whose action names their context value: a board's open buttons, Send to agent on a ref or a finding */
const ROW_CONTEXT = new Set(['board', 'ref', 'finding'])

const ICON_COLORS: Record<string, string> = { error: 'list.errorForeground', warning: 'list.warningForeground' }

export class Sidebar implements vscode.Disposable {
  readonly providers = Object.fromEntries(TREES.map(t => [t, new Provider(t === 'boards' ? async node => { await this.resolveConfig(node) } : undefined)])) as Record<Tree, Provider>
  private readonly views = new Map<Tree, vscode.TreeView<Node>>()
  private loaded: unknown
  private loading?: { boards: unknown; link: Source; promise: Promise<{ sites: Site[]; held: Map<string, string> }> }
  private sites: Site[] = []
  /** the hash of each facet the sites were built from, by `session/state`'s key */
  private held = new Map<string, string>()
  private last: { link: Source | undefined; board: Board | undefined; root: string } = { link: undefined, board: undefined, root: '' }
  private gen = 0
  /** the Worktrees node, after the boards */
  private worktrees: Node[] = []
  private boardsShown: Node[] = []
  /** each tree's open and selected nodes, carried across recompiles by carryState */
  readonly state = Object.fromEntries(TREES.map(t => [t, { expanded: [] } as TreeState])) as Record<Tree, TreeState>

  constructor(
    private readonly facets: LoadFacets = sessionFacets,
    register = true,
    private readonly declared: Declared = configDeclared,
  ) {
    if (register) for (const t of TREES) this.views.set(t, this.track(t, vscode.window.createTreeView(`pcbjs.${t}`, { treeDataProvider: this.providers[t], canSelectMany: true })))
  }

  /** the rows each tree has selected, by node */
  private picked = new Map<Tree, readonly Node[]>()
  /** the row a session selection revealed, so its selection event is not taken for the user's */
  private revealing: string | undefined

  private track(t: Tree, view: vscode.TreeView<Node>): vscode.TreeView<Node> {
    const st = () => this.state[t]
    view.onDidChangeSelection(e => {
      st().selected = e.selection[0]?.id
      this.picked.set(t, e.selection)
      if (this.revealing && e.selection.length === 1 && e.selection[0].id === this.revealing) this.revealing = undefined
    })
    view.onDidExpandElement(e => {
      st().expanded = [...new Set([...st().expanded, e.element.id])]
      st().collapsed = st().collapsed?.filter(id => id !== e.element.id)
    })
    view.onDidCollapseElement(e => {
      st().expanded = st().expanded.filter(id => id !== e.element.id)
      st().collapsed = [...new Set([...(st().collapsed ?? []), e.element.id])]
    })
    return view
  }

  /** New nodes for a tree, with what was open and selected carried over; a selection that moved to a new id is revealed. */
  private show(t: Tree, next: Node[]): void {
    const stamp = (nodes: Node[]): void => {
      for (const n of nodes) {
        if (n.action) {
          if (this.last.link?.session) n.action.session = this.last.link.session
          if (['finding', 'ref', 'net', 'source'].includes(n.action.kind)) {
            n.action.project ??= this.last.root
            n.action.target = null
          }
        }
        if (n.children) stamp(n.children)
      }
    }
    stamp(next)
    const was = this.state[t]
    const now = carryState(this.providers[t].nodes, next, was)
    this.state[t] = now
    this.providers[t].set(withExpanded(next, now.expanded, now.collapsed))
    const node = now.selected && now.selected !== was.selected ? this.providers[t].node(now.selected) : undefined
    if (node) void this.views.get(t)?.reveal(node, { select: true, focus: false })
  }

  /** Every reference the selected rows of every tree name on a board, `clicked` last so it is the anchor. */
  selectedRefs(board: string, clicked: string): string[] {
    const refs = [...this.picked.values()].flat().flatMap(n => (n.action?.kind === 'ref' && n.action.board === board ? [n.action.ref] : []))
    return [...new Set([...refs.filter(r => r !== clicked), clicked])]
  }

  /** A row of the Boards tree expanded, as a folder's click does. */
  async expand(id: string): Promise<void> {
    const node = this.providers.boards.node(id)
    if (node) await this.views.get('boards')?.reveal(node, { expand: true, focus: false, select: true })
  }

  /** A session selection: the anchor's row revealed and selected in the Boards tree, without taking focus. */
  reveal(refs: readonly string[], anchor: string | null): void {
    const want = anchor ?? refs[refs.length - 1]
    const view = this.views.get('boards')
    if (!want || !view) return
    const find = (ns: Node[]): Node | undefined => {
      for (const n of ns) {
        if (n.action?.kind === 'ref' && n.action.ref === want) return n
        const c = find(n.children ?? [])
        if (c) return c
      }
      return undefined
    }
    const node = find(this.providers.boards.nodes)
    if (!node || this.picked.get('boards')?.some(n => n.id === node.id)) return
    this.revealing = node.id
    void view.reveal(node, { select: true, focus: false })
  }

  /** Called on every change of the session that owns the shown board; reloads the facets when a new boards message came. */
  async update(link: Source | undefined, board: Board | undefined): Promise<void> {
    const gen = ++this.gen
    const boards = link?.boards
    const root = link?.boards?.root ?? link?.scope?.root ?? link?.root ?? ''
    this.last = { link, board, root }
    if (boards !== this.loaded) {
      if (link && boards && (this.loading?.boards !== boards || this.loading.link !== link)) this.loading = { boards, link, promise: this.load(link, root, boards.boards) }
      const got = link && boards ? await this.loading!.promise : { sites: [], held: new Map<string, string>() }
      if (gen !== this.gen) return
      this.loaded = boards
      this.loading = undefined
      this.sites = got.sites
      this.held = got.held
    }
    const scopes = link?.scopes
    const projects = scopes ?? { single: true, displayed: null, scopes: root ? [{ root } as ScopesMsg['scopes'][number]] : [] }
    const declared = await this.declared(projects).catch(() => ({}))
    const configs = Object.fromEntries(projects.scopes.map(s => [s.root, configFile(s.root)]))
    if (gen !== this.gen || this.last.link !== link || this.last.board !== board) return
    const site = this.sites.find(s => s.name === board?.name) ?? this.sites[0]
    const shown = this.sites.find(s => s.name === board?.name)
    const nodes = boardNodes(boards, scopes, board?.name, shown ? partNodes(shown, root) : [], declared, configs, file => {
      const folder = path.dirname(vscode.workspace.asRelativePath(file))
      return folder === '.' || path.isAbsolute(folder) ? path.basename(path.dirname(file)) : folder
    })
    const workspaceRoots = new Set(vscode.workspace.workspaceFolders?.map(f => path.resolve(f.uri.fsPath)))
    const resolved = await Promise.all(nodes.map(async node => {
      if (!node.load || !workspaceRoots.has(path.resolve(node.load.root))) return [node]
      const ready = await this.resolveConfig(node)
      return ready && node.children?.length ? node.children : [node]
    }))
    if (gen !== this.gen || this.last.link !== link || this.last.board !== board) return
    this.boardsShown = resolved.flat()
    this.show('boards', [...this.boardsShown, ...this.worktrees])
    this.show('findings', findingNodes(this.sites, root))
    for (const t of ['boards', 'findings'] as const) {
      const view = this.views.get(t)
      if (view) view.description = 'First target'
    }
    this.show('nets', site ? netNodes(site) : [])
    this.show('bom', site ? bomNodes(site, root) : [])
    for (const t of ['nets', 'bom'] as const) {
      const view = this.views.get(t)
      if (view) view.description = site ? `${site.title || site.name} · first target` : undefined
    }
  }

  /** Expand resolves all declared entries through one read-only query, preserving viewer focus. */
  private async resolveConfig(node: Node): Promise<boolean> {
    const load = node.load
    const link = this.last.link
    const gen = this.gen
    if (!load || !link?.request) return true
    try {
      const result = await link.request('session/boards', { project: load.root, entries: load.entries })
      if (gen !== this.gen || this.last.link !== link) return false
      node.children = result.value.boards.flatMap(b => b.name ? [boardRow({ name: b.name, entry: b.entry, status: b.current ? 'ok' : 'error', targets: b.targets?.filter((t): t is string => t !== null) }, load.root === this.last.root ? this.last.board?.name : undefined, [], load.route, load.root)] : [])
      const current = this.sites.find(s => s.name === this.last.board?.name)
      for (const child of node.children) {
        if (child.action) child.action.session = link.session
        if (current && load.root === this.last.root && child.action?.kind === 'board' && child.action.name === current.name) {
          child.children = partNodes(current, load.root)
          const stamp = (nodes: Node[]): void => {
            for (const part of nodes) {
              if (part.action) Object.assign(part.action, { session: link.session, project: load.root, target: null })
              if (part.children) stamp(part.children)
            }
          }
          stamp(child.children)
        }
      }
      node.description = node.children.length ? undefined : result.value.boards[0]?.reason ?? 'No boards registered'
      return true
    } catch (error) {
      if (gen !== this.gen || this.last.link !== link) return false
      node.description = `Unable to resolve: ${error instanceof Error ? error.message : String(error)}`
      return false
    }
  }

  setWorktrees(nodes: Node[]): void {
    this.worktrees = nodes
    this.show('boards', [...this.boardsShown, ...nodes])
  }

  setAgents(nodes: Node[]): void {
    this.show('agents', nodes)
  }

  /** The node of a tree by id, for a command run from its menu. */
  node(t: Tree, id: string): Node | undefined {
    return this.providers[t].node(id)
  }

  /** `session/state` of a project: a facet the trees hold whose hash moved is a desync, resynced quietly by loading the facets again. */
  synced(project: unknown, facets: Record<string, string> | undefined): void {
    const { link, board, root } = this.last
    if (!facets || typeof project !== 'string' || !root || path.resolve(project) !== path.resolve(root)) return
    if (![...this.held].some(([k, h]) => k in facets && facets[k] !== h)) return
    this.loaded = undefined
    void this.update(link, board)
  }

  /** Each entry's facets merged into the site data of its board, its first target's for a board with variants. */
  private async load(link: Source, root: string, boards: { name: string; entry: string }[]): Promise<{ sites: Site[]; held: Map<string, string> }> {
    const entries = [...new Set(boards.map(b => path.resolve(root, b.entry)))]
    const all = await Promise.all(entries.map(e => this.facets(link, e).catch(() => [] as Facet[])))
    const held = new Map<string, string>()
    const sites: Site[] = []
    for (const facets of all) {
      if (!facets?.length) continue
      for (const f of facets) held.set(facetKey(f), f.hash)
      const groups = new Map<string, Facet[]>()
      for (const f of facets) {
        const group = groups.get(f.board)
        if (!group) groups.set(f.board, [f])
        else if (group[0].target === f.target) group.push(f)
      }
      for (const group of groups.values()) {
        const site = Object.assign({}, ...group.map(f => f.data)) as Site
        if (typeof site.name === 'string' && Array.isArray(site.nets)) sites.push({ ...site, drc: site.drc ?? [], bom: site.bom ?? [] })
      }
    }
    return { sites, held }
  }

  dispose(): void {
    for (const v of this.views.values()) v.dispose()
    for (const p of Object.values(this.providers)) p.dispose()
  }
}
