// Where a jump from a preview item to its source opens, so the preview pane is never covered.

import * as vscode from 'vscode'
import type { SelectParams } from '@pcbjs/core/protocol'
import { PANEL_TYPE } from './preview'

export interface RevealDeps {
  /** the column of the last focused text editor */
  last(): vscode.ViewColumn | undefined
  /** the size in px of the preview pane in a column, as its page measured it */
  size(column: vscode.ViewColumn): { w: number; h: number } | undefined
}

const isPane = (t: vscode.Tab | undefined) => t?.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith(PANEL_TYPE)
const isFile = (t: vscode.Tab, uri: vscode.Uri) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString()
const tabOf = (g: vscode.TabGroup, uri: vscode.Uri) => g.tabs.find(t => isFile(t, uri))

/** Only the preview receiving the interaction owns a group we must keep visible. */
function home(): vscode.TabGroup | undefined {
  const { activeTabGroup: active } = vscode.window.tabGroups
  return isPane(active?.activeTab) ? active : undefined
}

async function wide(size: { w: number; h: number } | undefined): Promise<boolean> {
  if (size?.w && size.h) return size.w >= size.h
  const layout = await Promise.resolve(vscode.commands.executeCommand<{ orientation?: number } | undefined>('vscode.getEditorLayout')).catch(() => undefined)
  return layout?.orientation !== 1
}

/** The column to open the file in, after creating a group left of or above the preview when no other group can take it. */
async function target(uri: vscode.Uri, deps: RevealDeps, from: vscode.TabGroup | undefined): Promise<vscode.ViewColumn> {
  const groups = vscode.window.tabGroups.all.filter(g => g !== from)
  const existing = groups.find(g => g.activeTab && isFile(g.activeTab, uri)) ?? groups.find(g => tabOf(g, uri))
  if (existing) return existing.viewColumn
  const others = groups.filter(g => !isPane(g.activeTab))
  const pick = others.find(g => g.viewColumn === deps.last()) ?? others[0] ?? groups.find(g => g.viewColumn === deps.last()) ?? groups[0]
  if (pick) return pick.viewColumn
  if (!from) return deps.last() ?? vscode.ViewColumn.One
  // the new group takes the active group's place in grid order
  const column = (vscode.window.tabGroups.activeTabGroup ?? from).viewColumn
  const left = await wide(deps.size(from.viewColumn))
  await vscode.commands.executeCommand(left ? 'workbench.action.newGroupLeft' : 'workbench.action.newGroupAbove')
  return column
}

function staleTab(uri: vscode.Uri, column: vscode.ViewColumn, from: vscode.TabGroup | undefined): vscode.Tab | undefined {
  return from && from.viewColumn !== column ? tabOf(from, uri) : undefined
}

/** Open the document beside the preview, move its tab out of the preview's group first, then select the range; `focus` false keeps focus where it is. */
export async function reveal(doc: vscode.TextDocument, sel: vscode.Selection, deps: RevealDeps, focus = true): Promise<vscode.TextEditor> {
  const from = home()
  const column = await target(doc.uri, deps, from)
  const existing = vscode.window.tabGroups.all.some(g => g.viewColumn === column && tabOf(g, doc.uri))
  const moving = !existing ? staleTab(doc.uri, column, from) : undefined
  const preview = moving ? moving.isPreview : true
  if (moving) {
    await vscode.window.showTextDocument(doc, { viewColumn: column, preserveFocus: true, preview })
    // found again, since a layout change can replace the tab objects
    const stale = staleTab(doc.uri, column, from)
    if (stale) await vscode.window.tabGroups.close(stale, true)
  }
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: column, preserveFocus: !focus, preview })
  editor.selection = sel
  editor.revealRange(sel, vscode.TextEditorRevealType.InCenter)
  return editor
}

/** `pcbjs/select` in the editor: the primary file's ranges as selections, the primary first, revealed beside the preview with `reveal`, focus given with `focus` and kept in the pane by `keep` otherwise; undefined when no editor shows it. */
export async function showSelect(
  p: SelectParams,
  deps: RevealDeps,
  keep: (show: () => Promise<vscode.TextEditor>) => Promise<vscode.TextEditor>,
): Promise<vscode.TextEditor | undefined> {
  const item = p.items.find(i => i.uri === p.primary.uri)
  const u = item && vscode.Uri.parse(item.uri)
  if (!item || !u || u.scheme !== 'file') return undefined
  const doc = await vscode.workspace.openTextDocument(u)
  const at = (q: { line: number; character: number }) => doc.validatePosition(new vscode.Position(q.line, q.character))
  const sels = item.ranges.map(r => new vscode.Selection(at(r.start), at(r.end)))
  const ordered = [sels[p.primary.index] ?? sels[0], ...sels.filter((_, i) => i !== p.primary.index)]
  const editor = !p.reveal
    ? vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === u.toString())
    : p.focus
      ? await reveal(doc, ordered[0], deps)
      : await keep(() => reveal(doc, ordered[0], deps, false))
  if (editor) editor.selections = ordered
  return editor
}
