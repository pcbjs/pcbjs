// Where a jump from a preview item to its source opens, so the preview pane is never covered.

import * as vscode from 'vscode'
import type { SelectParams } from '@pcbjs/core/protocol'
import { isPreview, isFile, fileTab, groupOf } from './editor-groups'

export interface RevealDeps {
  /** the column of the last focused text editor */
  last(): vscode.ViewColumn | undefined
  /** the size in px of the preview pane in a column, as its page measured it */
  size(column: vscode.ViewColumn): { w: number; h: number } | undefined
}

let ticket = 0
let pending: Promise<unknown> = Promise.resolve()
const waiting = new Set<{ group: vscode.TabGroup; tab: vscode.Tab | undefined }>()

type Keep = (show: () => Promise<vscode.TextEditor | undefined>, valid: () => boolean) => Promise<vscode.TextEditor | undefined>

/** Host commands cannot be cancelled; serialize mutations so an older completion cannot replace a newer reveal. */
function request() {
  const id = ++ticket
  const origin = vscode.window.tabGroups.activeTabGroup
  const tab = origin?.activeTab
  const expected = { group: origin, tab }
  waiting.add(expected)
  const focused = () => vscode.window.tabGroups.activeTabGroup === expected.group && expected.group?.activeTab === expected.tab
  const valid = () => id === ticket && focused()
  return {
    finish: () => waiting.delete(expected),
    current: () => id === ticket,
    from: isPreview(tab) ? tab : undefined,
    valid,
    focused,
    expect(group: vscode.TabGroup) {
      const before = { ...expected }
      for (const other of waiting)
        if (other.group === before.group && other.tab === before.tab) {
          other.group = group
          other.tab = group.activeTab
        }
      expected.group = group
      expected.tab = group.activeTab
    },
    run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      const next = pending.then(() => (valid() ? fn() : undefined))
      pending = next.catch(() => undefined)
      return next
    },
  }
}
type Request = ReturnType<typeof request>
async function withNavigation<T>(fn: (op: Request) => Promise<T>): Promise<T> {
  const op = request()
  try {
    return await fn(op)
  } finally {
    op.finish()
  }
}

async function wide(size: { w: number; h: number } | undefined): Promise<boolean> {
  if (size?.w && size.h) return size.w >= size.h
  const layout = await Promise.resolve(vscode.commands.executeCommand<{ orientation?: number } | undefined>('vscode.getEditorLayout')).catch(() => undefined)
  return layout?.orientation !== 1
}

/** Choose by group identity, resolving columns only immediately before a host operation. */
async function target(uri: vscode.Uri, deps: RevealDeps, op: Request): Promise<vscode.TabGroup | undefined> {
  const from = groupOf(op.from)
  const groups = vscode.window.tabGroups.all.filter(g => g !== from)
  const existing = groups.find(g => g.activeTab && isFile(g.activeTab, uri)) ?? groups.find(g => fileTab(g, uri))
  if (existing) return existing
  const others = groups.filter(g => !isPreview(g.activeTab))
  const pick = others.find(g => g.viewColumn === deps.last()) ?? others[0] ?? groups.find(g => g.viewColumn === deps.last()) ?? groups[0]
  if (pick) return pick
  if (!from) return vscode.window.tabGroups.activeTabGroup
  const left = await wide(deps.size(from.viewColumn))
  if (!op.valid() || groupOf(op.from) !== from) return undefined
  const before = [...vscode.window.tabGroups.all]
  await vscode.commands.executeCommand(left ? 'workbench.action.newGroupLeft' : 'workbench.action.newGroupAbove')
  const created = vscode.window.tabGroups.all.filter(g => !before.includes(g) && !g.tabs.includes(op.from!))
  const active = vscode.window.tabGroups.activeTabGroup
  if (created.length !== 1 || (active !== created[0] && active !== from)) return undefined
  op.expect(active)
  return op.valid() ? created[0] : undefined
}

function staleTab(uri: vscode.Uri, dest: vscode.TabGroup, op: Request): vscode.Tab | undefined {
  const from = groupOf(op.from)
  return from && from !== dest ? fileTab(from, uri) : undefined
}

async function navigate(doc: vscode.TextDocument, sel: vscode.Selection, deps: RevealDeps, focus: boolean, op: Request): Promise<vscode.TextEditor | undefined> {
  const dest = await target(doc.uri, deps, op)
  const safe = () => op.valid() && !!dest && vscode.window.tabGroups.all.includes(dest) && dest !== groupOf(op.from)
  if (!dest || !safe()) return undefined
  const moving = !fileTab(dest, doc.uri) ? staleTab(doc.uri, dest, op) : undefined
  const preview = moving ? moving.isPreview : true
  const show = async (preserveFocus: boolean) => {
    const focused = vscode.window.tabGroups.activeTabGroup === dest
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: dest.viewColumn, preserveFocus, preview })
    if ((!preserveFocus || focused) && vscode.window.tabGroups.activeTabGroup === dest && dest.activeTab && isFile(dest.activeTab, doc.uri)) op.expect(dest)
    return editor
  }
  if (moving) {
    await show(true)
    if (!safe()) return undefined
    const stale = staleTab(doc.uri, dest, op)
    if (stale) await vscode.window.tabGroups.close(stale, true)
    if (!safe()) return undefined
  }
  const editor = await show(!focus)
  if (!safe()) return undefined
  editor.selection = sel
  editor.revealRange(sel, vscode.TextEditorRevealType.InCenter)
  return editor
}

/** Open beside the originating preview, with temporary tabs and cancellable selection/focus completion. */
export async function reveal(doc: vscode.TextDocument, sel: vscode.Selection, deps: RevealDeps, focus = true): Promise<vscode.TextEditor | undefined> {
  return withNavigation(op => op.run(() => navigate(doc, sel, deps, focus, op)))
}

/** Apply source ranges in primary-first order without stealing the originating preview. */
export async function showSelect(p: SelectParams, deps: RevealDeps, keep: Keep): Promise<vscode.TextEditor | undefined> {
  return withNavigation(async op => {
    const item = p.items.find(i => i.uri === p.primary.uri)
    const u = item && vscode.Uri.parse(item.uri)
    if (!item?.ranges.length || !u || u.scheme !== 'file') return undefined
    const doc = await vscode.workspace.openTextDocument(u)
    if (!op.valid()) return undefined
    const at = (q: { line: number; character: number }) => doc.validatePosition(new vscode.Position(q.line, q.character))
    const sels = item.ranges.map(r => new vscode.Selection(at(r.start), at(r.end)))
    const ordered = [sels[p.primary.index] ?? sels[0], ...sels.filter((_, i) => i !== p.primary.index)]
    return op.run(async () => {
      const show = async (focus: boolean) => {
        const editor = await navigate(doc, ordered[0], deps, focus, op)
        if (editor && op.valid()) editor.selections = ordered
        return editor
      }
      const kept = async () => {
        let restore = false
        try {
          return await keep(
            () => show(false),
            () => (restore = op.focused()),
          )
        } finally {
          if (restore) op.expect(vscode.window.tabGroups.activeTabGroup)
        }
      }
      const editor = !p.reveal ? vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === u.toString()) : p.focus ? await show(true) : await kept()
      if (!p.reveal && editor && op.valid()) editor.selections = ordered
      return op.current() ? editor : undefined
    })
  })
}
