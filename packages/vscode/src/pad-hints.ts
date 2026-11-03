import * as vscode from 'vscode'
import type { PcbjsSession } from './lsp-client'

/** Caret-driven pad help uses the owning language server's standard signature provider. */
export class PadHints implements vscode.Disposable {
  private readonly subs: vscode.Disposable[] = []
  private timer: NodeJS.Timeout | undefined
  private generation = 0
  private opened: vscode.TextEditor | undefined
  private lastSession: PcbjsSession | undefined
  private last = ''
  private disposed = false

  constructor(private readonly sessionFor: (doc: vscode.TextDocument) => PcbjsSession | undefined) {
    this.subs.push(
      vscode.window.onDidChangeTextEditorSelection(e => {
        if (e.textEditor === vscode.window.activeTextEditor) this.refresh()
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === vscode.window.activeTextEditor?.document) this.refresh()
      }),
      vscode.workspace.onDidCloseTextDocument(doc => {
        if (doc === vscode.window.activeTextEditor?.document) this.refresh()
      }),
    )
  }

  /** Recheck after document ownership or a language client changes. */
  refresh(): void {
    if (this.disposed) return
    clearTimeout(this.timer)
    const generation = ++this.generation
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document.isClosed || editor.document.uri.scheme !== 'file' || !['typescript', 'typescriptreact'].includes(editor.document.languageId) || editor.selections.length !== 1 || !editor.selection.isEmpty) {
      this.close()
      return
    }
    const session = this.sessionFor(editor.document)
    if (!session) {
      this.close()
      return
    }
    if ((this.lastSession && this.lastSession !== session) || (this.opened && this.opened !== editor)) this.close()
    const document = editor.document, version = document.version
    const position = editor.selection.active
    const key = `${document.uri}:${version}:${position.line}:${position.character}`
    if (key === this.last && session === this.lastSession) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.check(editor, session, position, version, generation, key)
    }, 16)
  }

  private async check(editor: vscode.TextEditor, session: PcbjsSession, position: vscode.Position, version: number, generation: number, key: string): Promise<void> {
    let eligible = false
    try {
      eligible = await session.signature(editor.document.uri.toString(), position, version)
    } catch {}
    if (this.disposed || generation !== this.generation || vscode.window.activeTextEditor !== editor || editor.document.isClosed || editor.document.version !== version || this.sessionFor(editor.document) !== session || !editor.selection.isEmpty || !editor.selection.active.isEqual(position)) return
    this.last = key
    this.lastSession = session
    if (!eligible) return this.close()
    this.opened = editor
    await vscode.commands.executeCommand('editor.action.triggerParameterHints').then(undefined, () => undefined)
  }

  private close(): void {
    this.last = ''
    this.lastSession?.clearSignature()
    this.lastSession = undefined
    const opened = this.opened
    this.opened = undefined
    if (opened && vscode.window.activeTextEditor === opened) void vscode.commands.executeCommand('closeParameterHints').then(undefined, () => undefined)
  }

  dispose(): void {
    this.disposed = true
    ++this.generation
    clearTimeout(this.timer)
    this.close()
    this.subs.forEach(s => s.dispose())
  }
}
