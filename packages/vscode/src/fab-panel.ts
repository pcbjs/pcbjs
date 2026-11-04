// The Fabrication dialog: a webview panel with one card per board and target, refreshed from session events, every button and
// blocker action run here. fab.ts builds the cards.

import * as vscode from 'vscode'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import errorIcon from '@vscode/codicons/src/icons/error.svg' with { type: 'text' }
import eventIcon from '@vscode/codicons/src/icons/symbol-event.svg' with { type: 'text' }
import disconnectIcon from '@vscode/codicons/src/icons/debug-disconnect.svg' with { type: 'text' }
import listIcon from '@vscode/codicons/src/icons/list-unordered.svg' with { type: 'text' }
import dirtyIcon from '@vscode/codicons/src/icons/circle-filled.svg' with { type: 'text' }
import commitIcon from '@vscode/codicons/src/icons/git-commit.svg' with { type: 'text' }
import tagIcon from '@vscode/codicons/src/icons/tag.svg' with { type: 'text' }
import beakerIcon from '@vscode/codicons/src/icons/beaker.svg' with { type: 'text' }
import historyIcon from '@vscode/codicons/src/icons/history.svg' with { type: 'text' }
import packageIcon from '@vscode/codicons/src/icons/package.svg' with { type: 'text' }
import { esc } from '@pcbjs/viewer/internal/boot-screen'
import { cards, readRepo, readSet, revInsert, sizeText, type Card, type CheckValue, type FabAction, type OnDisk, type Repo, type SetInfo } from './fab'

export const FAB_PANEL = 'pcbjs.fab'

const ICONS: Record<string, string> = {
  error: errorIcon,
  'symbol-event': eventIcon,
  'debug-disconnect': disconnectIcon,
  'list-unordered': listIcon,
  'circle-filled': dirtyIcon,
  'git-commit': commitIcon,
  tag: tagIcon,
  beaker: beakerIcon,
  history: historyIcon,
  package: packageIcon,
}

export interface FabHost {
  /** the project roots the session serves */
  projects(): string[]
  origin?(root: string): string | undefined
  connected?(root: string, session?: string): boolean
  /** `session/check { project, report: true }` */
  check(root: string): Promise<CheckValue>
  /** the finding in the code and the preview */
  openFinding(a: Extract<FabAction, { kind: 'finding' }>, origin: { root: string; session?: string }): Promise<void>
  /** `pcbjs build` in the project with the extra environment; true when it passed */
  build(root: string, env: Record<string, string>): Promise<boolean>
  repo?(root: string): Promise<Repo | null>
  read?(s: SetInfo): OnDisk
}

export type Button = 'build' | 'reveal' | 'folder' | 'sha'

export class FabPanel implements vscode.Disposable {
  panel: vscode.WebviewPanel | undefined
  cards: Card[] = []
  /** a line per project the session could not check */
  problems: string[] = []
  private timer: NodeJS.Timeout | undefined
  private busy: Promise<void> | undefined
  private again = false
  private repos = new Map<string, Repo | null>()

  constructor(private readonly h: FabHost) {}

  /** Reveal the panel, or open it; the modal editor overlay is closed to extensions until ViewColumn.Modal lands, microsoft/vscode#307835. */
  async open(): Promise<void> {
    if (this.panel) this.panel.reveal(vscode.ViewColumn.Active)
    else {
      const panel = vscode.window.createWebviewPanel(FAB_PANEL, 'Fabrication', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: false })
      this.panel = panel
      panel.onDidDispose(() => (this.panel = undefined))
      panel.webview.onDidReceiveMessage(m => void this.receive(m))
    }
    await this.refresh()
  }

  /** A refresh soon, one for a burst of events. */
  schedule(ms = 300): void {
    if (!this.panel) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.refresh(), ms)
  }

  /** Every project's cards again, one gather at a time. */
  refresh(): Promise<void> {
    if (this.busy) {
      this.again = true
      return this.busy
    }
    this.busy = this.gather().finally(() => {
      this.busy = undefined
      if (this.again) {
        this.again = false
        void this.refresh()
      }
    })
    return this.busy
  }

  private async gather(): Promise<void> {
    const all: Card[] = []
    const problems: string[] = []
    const dirty = vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.scheme === 'file').map(d => d.uri.fsPath)
    for (const root of this.h.projects()) {
      try {
        const before = this.h.origin?.(root)
        const v = await this.h.check(root)
        const session = v.session ?? before
        const repo = await (this.h.repo ?? readRepo)(root)
        this.repos.set(root, repo)
        all.push(...cards(root, v, dirty, repo, this.h.read ?? readSet).map(c => ({ ...c, session })))
        for (const d of v.report.diagnostics) problems.push(`${d.entry ?? path.basename(root)}: ${d.message}`)
      } catch (err) {
        problems.push(`${path.basename(root)}: ${(err as Error).message}`)
      }
    }
    this.cards = all
    this.problems = problems
    this.render()
  }

  private render(): void {
    if (this.panel) this.panel.webview.html = fabHtml(this.cards, this.problems, randomBytes(16).toString('base64'))
  }

  async receive(m: any): Promise<void> {
    const c = this.cards.find(x => x.key === m?.key)
    if (!c) return
    if (m.type === 'blocker' && c.blockers[m.index]) await this.act(c, c.blockers[m.index].action)
    if (m.type === 'button') await this.press(c, m.name)
  }

  /** A card's button: build, reveal the zip, show its folder, copy its sha256. */
  async press(c: Card, b: Button): Promise<void> {
    if (b === 'build') return this.act(c, { kind: 'build', label: 'Build' })
    if (b === 'reveal' && c.zip) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(c.zip))
    if (b === 'folder') await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(c.dir))
    if (b === 'sha' && c.sha256) {
      await vscode.env.clipboard.writeText(c.sha256)
      vscode.window.setStatusBarMessage(`pcbjs: copied the sha256 of ${c.zipName}`, 3000)
    }
  }

  /** What a blocker's button does. */
  async act(c: Card, a: FabAction): Promise<void> {
    if (a.kind === 'finding') {
      if (this.h.connected && !this.h.connected(c.root, c.session)) {
        this.problems = [...new Set([...this.problems, `${path.basename(c.root)}: this card belongs to a disconnected session. Reopen Fabrication to refresh it.`])]
        this.render()
        return
      }
      await this.h.openFinding(a, { root: c.root, session: c.session })
    } else if (a.kind === 'findings') await vscode.commands.executeCommand('pcbjs.findings.focus')
    else if (a.kind === 'scm') await vscode.commands.executeCommand('workbench.view.scm')
    else if (a.kind === 'open') await vscode.window.showTextDocument(vscode.Uri.file(a.file), { preview: true })
    else if (a.kind === 'save') {
      const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === a.file)
      await doc?.save()
      await this.refresh()
    } else if (a.kind === 'rev') await this.addRev(a.file)
    else if (a.kind === 'build') {
      const head = this.repos.get(c.root)?.head
      // the last commit dates every file, so two builds of one commit are byte identical
      await this.h.build(c.root, head ? { SOURCE_DATE_EPOCH: String(head) } : {})
      await this.refresh()
    }
  }

  /** `rev="0.1.0"` on the entry's `<PCB>`, saved, with the value selected for an edit. */
  private async addRev(file: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file))
    const ins = revInsert(doc.getText())
    if (!ins) {
      await vscode.window.showTextDocument(doc, { preview: true })
      void vscode.window.showWarningMessage(`pcbjs: ${path.basename(file)} has no <PCB> to put a rev on; add rev="0.1.0" where the board is made.`)
      return
    }
    const at = doc.positionAt(ins.offset)
    const edit = new vscode.WorkspaceEdit()
    edit.replace(doc.uri, new vscode.Range(at, at), ins.text)
    await vscode.workspace.applyEdit(edit)
    await doc.save()
    const start = doc.positionAt(ins.offset + ' rev="'.length)
    const end = doc.positionAt(ins.offset + ins.text.length - 1)
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(start, end), preview: true })
    await this.refresh()
  }

  dispose(): void {
    clearTimeout(this.timer)
    this.panel?.dispose()
  }
}

const PILL: Record<Card['pill'], string> = { ORDERABLE: 'ok', BLOCKED: 'bad', STALE: 'stale' }

function cardHtml(c: Card): string {
  const title = esc(c.target ? `${c.name} · ${c.target}` : c.name)
  const facts = [
    ['Zip', c.zipName ? esc(c.zipName) : 'none yet'],
    ['Size', c.zip ? sizeText(c.size) : '·'],
    ['sha256', c.sha256 ? `<code>${c.sha256}</code>` : '·'],
    ['Date', c.date ? `${esc(c.date)}, ${esc(c.dateSource)}` : '·'],
  ]
  const button = (name: string, label: string, on = true) => `<button data-key="${esc(c.key)}" data-button="${name}"${on ? '' : ' disabled'}>${label}</button>`
  const blockers = c.blockers
    .map(
      (b, i) =>
        `<li><span class="icon">${ICONS[b.icon] ?? ''}</span><span class="text">${esc(b.text)}</span><button class="act" data-key="${esc(c.key)}" data-blocker="${i}">${esc(b.action.label)}</button></li>`,
    )
    .join('')
  return `<section class="card"><header><h2>${title}</h2><span class="pill ${PILL[c.pill]}">${c.pill}</span></header>
<dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
<div class="buttons">${button('build', 'Build')}${button('reveal', 'Reveal zip', !!c.zip)}${button('folder', 'Open folder', !!c.zip)}${button('sha', 'Copy sha', !!c.sha256)}</div>
${blockers ? `<ul class="blockers">${blockers}</ul>` : ''}</section>`
}

export function fabHtml(all: Card[], problems: string[], nonce: string): string {
  const body = all.length || problems.length ? all.map(cardHtml).join('\n') : '<p class="empty">The session lists no board yet.</p>'
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
body { font: var(--vscode-font-size) var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 24px; max-width: 880px; }
h1 { font-size: 1.4em; font-weight: 600; margin: 0 0 16px; }
.card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px 16px; margin: 0 0 16px; }
header { display: flex; align-items: center; gap: 12px; }
h2 { font-size: 1.1em; margin: 0; flex: 1; }
.pill { font-size: 0.85em; font-weight: 700; letter-spacing: 0.04em; padding: 2px 10px; border-radius: 10px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); }
.pill.ok { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
.pill.bad { background: var(--vscode-errorForeground); color: var(--vscode-editor-background); }
.pill.stale { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 12px 0; }
dt { color: var(--vscode-descriptionForeground); }
dd { margin: 0; overflow-wrap: anywhere; }
code { font-family: var(--vscode-editor-font-family); font-size: 0.95em; }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; }
button { font: inherit; padding: 4px 12px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: 0.5; cursor: default; }
button.act { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); white-space: nowrap; }
.blockers { list-style: none; padding: 0; margin: 12px 0 0; border-top: 1px solid var(--vscode-panel-border); }
.blockers li { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.icon { display: inline-flex; width: 16px; height: 16px; flex: none; }
.text { flex: 1; }
.problem, .empty { color: var(--vscode-errorForeground); }
.empty { color: var(--vscode-descriptionForeground); }
</style></head><body>
<h1>Fabrication</h1>
${problems.map(p => `<p class="problem">${esc(p)}</p>`).join('\n')}
${body}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi()
document.addEventListener('click', e => {
  const b = e.target.closest('button')
  if (!b || b.disabled) return
  if (b.dataset.blocker !== undefined) vscode.postMessage({ type: 'blocker', key: b.dataset.key, index: Number(b.dataset.blocker) })
  else vscode.postMessage({ type: 'button', key: b.dataset.key, name: b.dataset.button })
})
</script></body></html>`
}
