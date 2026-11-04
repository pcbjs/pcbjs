import * as vscode from 'vscode'

export const PANEL_TYPE = 'pcbjs.preview'
export const isPreview = (tab: vscode.Tab | undefined): boolean => tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(PANEL_TYPE)
export const isFile = (tab: vscode.Tab, uri: vscode.Uri): boolean => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()
export const fileTab = (group: vscode.TabGroup, uri: vscode.Uri): vscode.Tab | undefined => group.tabs.find(tab => isFile(tab, uri))
export const groupOf = (tab: vscode.Tab | undefined): vscode.TabGroup | undefined => tab && vscode.window.tabGroups.all.find(group => group.tabs.includes(tab))
