// The numbers, units and layers inside coordinate strings in their own colours: decorations from the server's `pcbjs/tokens`, so
// TypeScript's semantic tokens stay, VS Code taking one provider per document.

import * as vscode from 'vscode'
import type { UnitToken } from '@pcbjs/core/protocol'
import { type PcbjsSession } from './lsp-client'

const COLOURS: Record<UnitToken['type'], string> = { number: 'pcbjs.unitNumber', unit: 'pcbjs.unitUnit', layer: 'pcbjs.unitLayer' }

export class UnitTokens implements vscode.Disposable {
  private readonly timers = new Map<vscode.TextEditor, NodeJS.Timeout>()
  private readonly subs: vscode.Disposable[] = []
  private readonly types = Object.fromEntries(
    Object.entries(COLOURS).map(([k, c]) => [k, vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor(c) })]),
  ) as Record<UnitToken['type'], vscode.TextEditorDecorationType>

  constructor(private readonly sessionFor: (doc: vscode.TextDocument) => PcbjsSession | undefined) {
    this.subs.push(
      ...Object.values(this.types),
      vscode.window.onDidChangeVisibleTextEditors(eds => eds.forEach(e => this.soon(e))),
      vscode.workspace.onDidChangeTextDocument(e => {
        for (const ed of vscode.window.visibleTextEditors) if (ed.document === e.document) this.soon(ed)
      }),
      { dispose: () => this.timers.forEach(t => clearTimeout(t)) },
    )
  }

  /** after a language client started or stopped */
  refresh(): void {
    vscode.window.visibleTextEditors.forEach(e => this.soon(e))
  }

  private soon(editor: vscode.TextEditor): void {
    clearTimeout(this.timers.get(editor))
    this.timers.set(
      editor,
      setTimeout(() => {
        this.timers.delete(editor)
        void this.decorate(editor)
      }, 200),
    )
  }

  private async decorate(editor: vscode.TextEditor): Promise<void> {
    const session = this.sessionFor(editor.document)
    let tokens: UnitToken[] = []
    if (session)
      try {
        tokens = await session.tokens(editor.document.uri.toString())
      } catch {}
    for (const [type, deco] of Object.entries(this.types) as [UnitToken['type'], vscode.TextEditorDecorationType][])
      editor.setDecorations(
        deco,
        tokens.filter(t => t.type === type).map(t => new vscode.Range(t.range.start.line, t.range.start.character, t.range.end.line, t.range.end.character)),
      )
  }

  dispose(): void {
    this.subs.forEach(s => s.dispose())
  }
}
