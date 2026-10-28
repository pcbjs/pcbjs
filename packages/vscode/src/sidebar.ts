// The pcbjs view container: Boards, Findings, Nets and BOM of the board the viewers show.

import * as vscode from 'vscode'
import type { PcbjsServer } from './server'
import { Node, Site, boardNodes, bomNodes, findingNodes, netNodes } from './tree-data'
import type { Board } from './views'

export const TREES = ['boards', 'findings', 'nets', 'bom'] as const
export type Tree = (typeof TREES)[number]

export type FetchJson = (url: string) => Promise<unknown>

const fetchJson: FetchJson = async url => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

class Provider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event
  nodes: Node[] = []

  set(nodes: Node[]): void {
    this.nodes = nodes
    this.changed.fire()
  }

  getChildren(node?: Node): Node[] {
    return node ? (node.children ?? []) : this.nodes
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const state = node.children ? (node.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None
    const item = new vscode.TreeItem(node.label, state)
    item.id = node.id
    item.description = node.description
    item.tooltip = node.tooltip
    if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon, ICON_COLORS[node.icon] ? new vscode.ThemeColor(ICON_COLORS[node.icon]) : undefined)
    if (node.action?.kind === 'board') item.contextValue = 'board'
    if (node.action) item.command = { command: 'pcbjs.sidebar.open', title: 'Show', arguments: [node.action] }
    return item
  }

  dispose(): void {
    this.changed.dispose()
  }
}

const ICON_COLORS: Record<string, string> = { error: 'list.errorForeground', warning: 'list.warningForeground' }

export class Sidebar implements vscode.Disposable {
  readonly providers = Object.fromEntries(TREES.map(t => [t, new Provider()])) as Record<Tree, Provider>
  private readonly views = new Map<Tree, vscode.TreeView<Node>>()
  private loaded: unknown
  private sites: Site[] = []
  private gen = 0

  constructor(
    private readonly fetch: FetchJson = fetchJson,
    register = true,
  ) {
    if (register) for (const t of TREES) this.views.set(t, vscode.window.createTreeView(`pcbjs.${t}`, { treeDataProvider: this.providers[t] }))
  }

  /** Called on every change of the server; reloads the site data when a new boards message came. */
  async update(server: PcbjsServer | undefined, board: Board | undefined): Promise<void> {
    const boards = server?.boards
    if (boards !== this.loaded) {
      this.loaded = boards
      const gen = ++this.gen
      const sites = server?.url && boards ? await this.load(server.url, boards.boards) : []
      if (gen !== this.gen) return
      this.sites = sites
    }
    const root = server?.boards?.root ?? server?.scope?.root ?? server?.root ?? ''
    const site = this.sites.find(s => s.name === board?.name) ?? this.sites[0]
    this.providers.boards.set(boardNodes(boards, server?.scopes, board?.name))
    this.providers.findings.set(findingNodes(this.sites, root))
    this.providers.nets.set(site ? netNodes(site) : [])
    this.providers.bom.set(site ? bomNodes(site, root) : [])
    for (const t of ['nets', 'bom'] as const) {
      const view = this.views.get(t)
      if (view) view.description = site ? site.title || site.name : undefined
    }
  }

  private async load(base: string, boards: { name: string }[]): Promise<Site[]> {
    const all = await Promise.all(boards.map(b => this.fetch(new URL(`/__pcbjs/${encodeURIComponent(b.name)}/board.json`, base).toString()).catch(() => undefined)))
    return all.filter((s): s is Site => !!s && typeof s === 'object' && Array.isArray((s as Site).nets))
  }

  dispose(): void {
    for (const v of this.views.values()) v.dispose()
    for (const p of Object.values(this.providers)) p.dispose()
  }
}
