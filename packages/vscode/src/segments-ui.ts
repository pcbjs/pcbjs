// The server computes every edit and checks every typed value, so a new kind needs no change here.

import * as vscode from 'vscode';
import { widgetOf, type PcbjsSession, type Presentation, type Segment } from './lsp-client';

export class SegmentsUi implements vscode.Disposable {
  private readonly cache = new Map<string, { version: number; segments: Segment[] }>();
  private readonly timers = new Map<vscode.TextEditor, NodeJS.Timeout>();
  private readonly subs: vscode.Disposable[] = [];
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline dotted',
    light: { textDecoration: 'underline dotted rgba(0, 0, 0, 0.35)' },
    dark: { textDecoration: 'underline dotted rgba(255, 255, 255, 0.35)' },
  });

  constructor(private readonly sessionFor: (doc: vscode.TextDocument) => PcbjsSession | undefined) {
    const selector: vscode.DocumentSelector = ['typescriptreact', 'typescript'].map((language) => ({ language, scheme: 'file' }));
    this.subs.push(
      this.decoration,
      vscode.languages.registerCodeActionsProvider(selector, { provideCodeActions: (doc, range) => this.actions(doc, range) }, { providedCodeActionKinds: [vscode.CodeActionKind.Empty] }),
      vscode.commands.registerCommand('pcbjs.editValue', (uri?: unknown, line?: unknown, character?: unknown) => this.edit(typeof uri === 'string' ? uri : undefined, typeof line === 'number' && typeof character === 'number' ? new vscode.Position(line, character) : undefined)),
      vscode.window.onDidChangeVisibleTextEditors((eds) => eds.forEach((e) => this.soon(e))),
      vscode.workspace.onDidChangeTextDocument((e) => {
        for (const ed of vscode.window.visibleTextEditors) if (ed.document === e.document) this.soon(ed);
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => this.cache.delete(doc.uri.toString())),
      { dispose: () => this.timers.forEach((t) => clearTimeout(t)) },
    );
  }

  /** after a language client started or stopped */
  refresh(): void {
    this.cache.clear();
    vscode.window.visibleTextEditors.forEach((e) => this.soon(e));
  }

  private soon(editor: vscode.TextEditor): void {
    clearTimeout(this.timers.get(editor));
    this.timers.set(editor, setTimeout(() => {
      this.timers.delete(editor);
      void this.decorate(editor);
    }, 200));
  }

  private async segments(doc: vscode.TextDocument): Promise<Segment[]> {
    const key = doc.uri.toString();
    const c = this.cache.get(key);
    if (c && c.version === doc.version) return c.segments;
    const session = this.sessionFor(doc);
    if (!session) return [];
    let segments: Segment[] = [];
    try {
      segments = await session.segments(key);
    } catch {}
    this.cache.set(key, { version: doc.version, segments });
    return segments;
  }

  private async decorate(editor: vscode.TextEditor): Promise<void> {
    const segs = this.sessionFor(editor.document) ? await this.segments(editor.document) : [];
    editor.setDecorations(this.decoration, segs.map((s) => range(s.range)));
  }

  private actions(doc: vscode.TextDocument, r: vscode.Range): vscode.CodeAction[] | undefined {
    const c = this.cache.get(doc.uri.toString());
    const seg = c?.version === doc.version ? c.segments.filter((s) => range(s.range).contains(r.start)).sort((a, b) => size(a) - size(b))[0] : undefined;
    if (!seg) return undefined;
    const a = new vscode.CodeAction(`pcbjs: edit ${seg.label}`, vscode.CodeActionKind.Empty);
    a.command = { command: 'pcbjs.editValue', title: 'pcbjs: edit value', arguments: [doc.uri.toString(), r.start.line, r.start.character] };
    return [a];
  }

  async edit(uri?: string, pos?: vscode.Position): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    const doc = uri ? await vscode.workspace.openTextDocument(vscode.Uri.parse(uri)) : ed?.document;
    if (!doc) return;
    const at = pos ?? (ed && ed.document === doc ? ed.selection.active : undefined);
    const session = this.sessionFor(doc);
    if (!at || !session) {
      void vscode.window.showInformationMessage('pcbjs: the dev server is not running for this file, or it has no language server.');
      return;
    }
    const seg = await session.segmentAt(doc.uri.toString(), { line: at.line, character: at.character }).catch(() => undefined);
    if (!seg) {
      void vscode.window.showInformationMessage('pcbjs: put the cursor on a value pcbjs can edit, such as an at, a layer, a width or a route path.');
      return;
    }
    const widget = widgetOf(seg);
    const pos0 = { line: seg.range.start.line, character: seg.range.start.character };
    // a choice of one, such as a side: no menu
    if (!widget.typed && seg.presentations.length === 1) return void this.apply(doc, session, seg.presentations[0]);
    const TYPE = '$(edit) Type a value...';
    const items: (vscode.QuickPickItem & { p?: Presentation; option?: string })[] = seg.presentations.map((p) => ({ label: p.label, description: p.detail, p }));
    if (!items.length) for (const option of widget.options ?? []) if (option !== seg.value) items.push({ label: option, option });
    if (widget.typed) items.unshift({ label: TYPE, description: seg.value });
    const unit = widget.unit ? ` ${widget.unit}` : '';
    const swatch = widget.preview ? `, ${widget.preview}` : '';
    const choice = await vscode.window.showQuickPick(items, { placeHolder: `${seg.label}: ${seg.value}${unit}${swatch}`, matchOnDescription: true });
    if (!choice) return;
    if (choice.p) return void this.apply(doc, session, choice.p);
    if (choice.option !== undefined) {
      const p = (await session.typed(doc.uri.toString(), pos0, choice.option).catch(() => undefined))?.presentations[0];
      return p ? void this.apply(doc, session, p) : undefined;
    }
    let last: Segment | undefined;
    const value = await vscode.window.showInputBox({
      title: seg.label,
      value: seg.value,
      prompt: widget.prompt ?? `a new value for ${seg.label}`,
      validateInput: async (v) => {
        last = await session.typed(doc.uri.toString(), pos0, v).catch(() => undefined);
        return last?.error ?? (last ? undefined : 'the server did not answer');
      },
    });
    if (value === undefined) return;
    if (!last || last.error) last = await session.typed(doc.uri.toString(), pos0, value).catch(() => undefined);
    const p = last?.presentations[0];
    if (p) await this.apply(doc, session, p);
  }

  private async apply(doc: vscode.TextDocument, session: PcbjsSession, p: Presentation): Promise<void> {
    const ok = await session.apply(doc.uri.toString(), p);
    if (ok && vscode.workspace.getConfiguration('pcbjs', doc.uri).get<boolean>('editorAutoSave', true)) await doc.save();
  }

  dispose(): void {
    this.subs.forEach((s) => s.dispose());
  }
}

const range = (r: Segment['range']) => new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
const size = (s: Segment) => (s.range.end.line - s.range.start.line) * 1e6 + s.range.end.character - s.range.start.character;
