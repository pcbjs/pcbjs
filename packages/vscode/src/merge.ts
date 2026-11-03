// A disk write the session reports as shadowed under unsaved text, merged three ways: the base is the text the editor last had in
// sync with disk, ours the buffer, theirs the disk. A clean merge reverts the buffer to disk and reapplies the user's changes, so a
// save never meets "the file has changed on disk"; a conflict opens the merge editor and the file stays held until resolved.

import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { hunks, merge3, splitLines } from './merge3'

export const MERGE_SCHEME = 'pcbjs-merge'

export type MergeResult = 'none' | 'clean' | 'conflict'

export interface MergeOptions {
  read?(file: string): string | null
  log?(line: string): void
}

const readFile = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export class Merger implements vscode.Disposable {
  /** per file, the text last in sync with disk */
  private readonly bases = new Map<string, string>()
  /** the sides of each conflict, served to the merge editor */
  private readonly sides = new Map<string, string>()
  private readonly subs: vscode.Disposable[] = []
  private readonly read: (file: string) => string | null

  constructor(private readonly o: MergeOptions = {}) {
    this.read = o.read ?? readFile
    const synced = (doc: vscode.TextDocument) => {
      if (doc.uri.scheme === 'file' && !doc.isDirty) this.bases.set(doc.uri.fsPath, doc.getText())
    }
    for (const doc of vscode.workspace.textDocuments) synced(doc)
    this.subs.push(
      vscode.workspace.onDidOpenTextDocument(synced),
      vscode.workspace.onDidSaveTextDocument(synced),
      // a revert or an undo back to the saved text
      vscode.workspace.onDidChangeTextDocument(e => synced(e.document)),
      vscode.workspace.onDidCloseTextDocument(doc => this.bases.delete(doc.uri.fsPath)),
      vscode.workspace.registerTextDocumentContentProvider(MERGE_SCHEME, { provideTextDocumentContent: uri => this.sides.get(uri.toString()) ?? '' }),
    )
  }

  base(file: string): string | undefined {
    return this.bases.get(file)
  }

  /** The session's `edit` event with `shadowed`: the file changed on disk under the editor's unsaved text; `by` names the writer. */
  async shadowed(file: string, by: string | null): Promise<MergeResult> {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === file)
    const theirs = this.read(file)
    if (!doc || theirs === null) return 'none'
    const ours = doc.getText()
    const base = this.bases.get(file)
    // a clean buffer follows the disk by itself; the editor's own save matches its text
    if (!doc.isDirty || theirs === ours || theirs === base) return 'none'
    const who = by ?? 'a write on disk'
    const rel = vscode.workspace.asRelativePath(file)
    const m = base === undefined ? undefined : merge3(base, ours, theirs, { ours: 'your unsaved text', theirs: who })
    if (m && !m.conflicts) {
      await this.reapply(doc, theirs, m.text, m.lines)
      this.o.log?.(`merged ${who}'s change to ${rel} into the unsaved text`)
      void vscode.window.showInformationMessage(`pcbjs: merged ${who}'s change to ${rel} into your unsaved text`)
      return 'clean'
    }
    await this.conflict(doc, base ?? theirs, ours, theirs, m?.text ?? ours, who)
    this.o.log?.(`${who}'s change to ${rel} conflicts with the unsaved text; the merge editor is open`)
    void vscode.window.showWarningMessage(
      `pcbjs: ${who}'s change to ${rel} conflicts with your unsaved text; resolve it in the merge editor, the session compiles your text until you save`,
    )
    return 'conflict'
  }

  /** Revert to the disk, then the user's changes as edits on it, the cursors mapped through the merge. */
  private async reapply(doc: vscode.TextDocument, theirs: string, merged: string, lines: number[]): Promise<void> {
    const editors = vscode.window.visibleTextEditors.filter(e => e.document === doc)
    const kept = editors.map(e => e.selections.map(s => new vscode.Selection(at(lines, s.anchor), at(lines, s.active))))
    await vscode.commands.executeCommand('workbench.action.files.revert', doc.uri)
    this.bases.set(doc.uri.fsPath, theirs)
    const t = splitLines(theirs)
    const m = splitLines(merged)
    const edit = new vscode.WorkspaceEdit()
    const line = (i: number) => new vscode.Position(i, 0)
    for (const h of hunks(t, m)) edit.replace(doc.uri, new vscode.Range(line(h.baseStart), line(h.baseEnd)), m.slice(h.start, h.end).join(''))
    await vscode.workspace.applyEdit(edit)
    editors.forEach((e, i) => (e.selections = kept[i]))
  }

  /** The merge editor on the three sides, its result the file with the conflict marked; the buffer stays unsaved. */
  private async conflict(doc: vscode.TextDocument, base: string, ours: string, theirs: string, marked: string, who: string): Promise<void> {
    const name = path.basename(doc.uri.fsPath)
    const side = (kind: string, text: string) => {
      const uri = vscode.Uri.parse(`${MERGE_SCHEME}:/${kind}/${encodeURIComponent(doc.uri.fsPath)}/${name}`)
      this.sides.set(uri.toString(), text)
      return uri
    }
    const sides = { base: side('base', base), ours: side('ours', ours), theirs: side('theirs', theirs) }
    await vscode.commands.executeCommand('workbench.action.files.revert', doc.uri)
    this.bases.set(doc.uri.fsPath, theirs)
    const edit = new vscode.WorkspaceEdit()
    edit.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), doc.positionAt(doc.getText().length)), marked)
    await vscode.workspace.applyEdit(edit)
    await vscode.commands.executeCommand('_open.mergeEditor', {
      base: sides.base,
      input1: { uri: sides.ours, title: 'Your unsaved text' },
      input2: { uri: sides.theirs, title: who },
      output: doc.uri,
    })
  }

  dispose(): void {
    this.subs.forEach(s => s.dispose())
  }
}

/** A position of ours in the merged text: its line mapped, else the line after the last one that was. */
function at(lines: number[], p: vscode.Position): vscode.Position {
  const l = lines[p.line]
  if (l !== undefined && l >= 0) return new vscode.Position(l, p.character)
  for (let i = Math.min(p.line, lines.length) - 1; i >= 0; i--) if (lines[i] >= 0) return new vscode.Position(lines[i] + 1, 0)
  return new vscode.Position(0, 0)
}
