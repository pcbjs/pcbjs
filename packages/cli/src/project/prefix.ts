import ts from 'typescript'
import type { Src } from '@pcbjs/core/internal/types'

/** Keep JSX before an evaluation failure, with a source boundary the preview traversal stops at. */
export function sourcePrefix(file: string, code: string, src: Src): string | null {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lines = sf.getLineStarts()
  if (!lines[src.line - 1] && src.line !== 1) return null
  const pos = lines[src.line - 1] + src.col - 1
  type Container = ts.JsxElement | ts.JsxFragment
  const container = (n: ts.Node): n is Container => ts.isJsxElement(n) || ts.isJsxFragment(n)
  const edits: { start: number; end: number; text: string }[] = []
  const blank = (n: ts.Node) => ({ start: n.getStart(sf), end: n.end, text: code.slice(n.getStart(sf), n.end).replace(/[^\r\n]/g, ' ') })
  let found = false
  const cut = (n: Container): void => {
    for (const child of n.children) {
      if (child.end <= pos) continue
      if (child.getStart(sf) > pos) edits.push(blank(child))
      else if (container(child) && (ts.isJsxElement(child) ? child.openingElement.end : child.openingFragment.end) <= pos) cut(child)
      else {
        const edit = blank(child)
        edit.text = `<g __src={${JSON.stringify(src)}} />` + edit.text
        edits.push(edit)
        found = true
      }
    }
  }
  const visit = (n: ts.Node): void => {
    if (n.getStart(sf) > pos || n.end <= pos) return
    if (container(n) && n.children.some(c => c.getStart(sf) <= pos && c.end > pos)) cut(n)
    else n.forEachChild(visit)
  }
  visit(sf)
  if (!found) return null
  let out = code
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}
