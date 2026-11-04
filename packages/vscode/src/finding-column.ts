import * as vscode from 'vscode'
import { isPreview } from './editor-groups'
import { isUnder, samePath } from './protocol'

/** Keep the active PCB preview visible, preferring the board's currently visible source. */
export function findingColumn(source?: string, project?: string): vscode.ViewColumn {
  const { all, activeTabGroup } = vscode.window.tabGroups
  const candidates = all.filter(group => group !== activeTabGroup || !isPreview(group.activeTab))
  const sourceGroup = candidates.find(group => {
    const input = group.activeTab?.input
    if (!(input instanceof vscode.TabInputText) || input.uri.scheme !== 'file') return false
    const file = input.uri.fsPath
    return source ? samePath(file, source) : /(?:^|[\\/]|\.)pcb\.tsx$/.test(file) && (!project || isUnder(project, file))
  })
  return (sourceGroup ?? candidates.find(group => !isPreview(group.activeTab)) ?? candidates[0])?.viewColumn ?? vscode.ViewColumn.Beside
}
