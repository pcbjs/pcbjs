// Where a jump from a preview item to its source opens, so the preview pane is never covered.

import * as vscode from 'vscode';
import { PANEL_TYPE } from './preview';

export interface RevealDeps {
  /** the column of the last focused text editor */
  last(): vscode.ViewColumn | undefined;
  /** the size in px of the preview pane in a column, as its page measured it */
  size(column: vscode.ViewColumn): { w: number; h: number } | undefined;
}

const isPane = (t: vscode.Tab | undefined) => t?.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith(PANEL_TYPE);
const isFile = (t: vscode.Tab, uri: vscode.Uri) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString();
const tabOf = (g: vscode.TabGroup, uri: vscode.Uri) => g.tabs.find((t) => isFile(t, uri));

/** The group whose visible tab is a preview pane: the active group first. */
function home(): vscode.TabGroup | undefined {
  const { activeTabGroup: active, all } = vscode.window.tabGroups;
  return isPane(active?.activeTab) ? active : all.find((g) => isPane(g.activeTab));
}

async function wide(size: { w: number; h: number } | undefined): Promise<boolean> {
  if (size?.w && size.h) return size.w >= size.h;
  const layout = await Promise.resolve(vscode.commands.executeCommand<{ orientation?: number } | undefined>('vscode.getEditorLayout')).catch(() => undefined);
  return layout?.orientation !== 1;
}

/** The column to open the file in, after creating a group left of or above the preview when no other group can take it. */
async function target(uri: vscode.Uri, deps: RevealDeps): Promise<vscode.ViewColumn> {
  const from = home();
  const others = vscode.window.tabGroups.all.filter((g) => g !== from && !isPane(g.activeTab));
  const pick = others.find((g) => g.activeTab && isFile(g.activeTab, uri)) ?? others.find((g) => tabOf(g, uri)) ?? others.find((g) => g.viewColumn === deps.last()) ?? others[0];
  if (pick) return pick.viewColumn;
  if (!from) return deps.last() ?? vscode.ViewColumn.One;
  // the new group takes the active group's place in grid order
  const column = (vscode.window.tabGroups.activeTabGroup ?? from).viewColumn;
  const left = await wide(deps.size(from.viewColumn));
  await vscode.commands.executeCommand(left ? 'workbench.action.newGroupLeft' : 'workbench.action.newGroupAbove');
  return column;
}

function staleTab(uri: vscode.Uri, column: vscode.ViewColumn): vscode.Tab | undefined {
  const from = home();
  return from && from.viewColumn !== column ? tabOf(from, uri) : undefined;
}

/** Open the document beside the preview, move its tab out of the preview's group first, then select the range. */
export async function reveal(doc: vscode.TextDocument, sel: vscode.Selection, deps: RevealDeps): Promise<vscode.TextEditor> {
  const column = await target(doc.uri, deps);
  if (staleTab(doc.uri, column)) {
    await vscode.window.showTextDocument(doc, { viewColumn: column, preserveFocus: true, preview: false });
    // found again, since a layout change can replace the tab objects
    const stale = staleTab(doc.uri, column);
    if (stale) await vscode.window.tabGroups.close(stale, true);
  }
  const editor = await vscode.window.showTextDocument(doc, { viewColumn: column, preserveFocus: false, preview: false });
  editor.selection = sel;
  editor.revealRange(sel, vscode.TextEditorRevealType.InCenter);
  return editor;
}
