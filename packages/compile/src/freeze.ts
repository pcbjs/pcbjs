// Freezing auto placement, see placement.md: each placed part's auto slots written into its `at` and its at:* props
// dropped, as text edits on the file that places it; `pcbjs place --write` and the editor's code action share it.
import ts from 'typescript'
import type { AutoPlaced } from '@pcbjs/core/model'

/** A replacement of text[start, end), offsets into the file. */
export interface TextSpan {
  start: number
  end: number
  newText: string
}

const DROP = new Set(['at:initial', 'at:cost', 'at:solver', 'at:follow'])

/** The edits that freeze each placed part whose element this file holds; `missed` lists those whose element it could not find or whose `at` is not a literal. */
export function freezeEdits(file: string, text: string, placed: readonly AutoPlaced[]): { edits: TextSpan[]; missed: AutoPlaced[] } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const tags = new Map<string, ts.JsxAttributes>()
  const visit = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const p = sf.getLineAndCharacterOfPosition(n.getStart(sf))
      tags.set(`${p.line + 1}:${p.character + 1}`, n.attributes)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  const edits: TextSpan[] = []
  const missed: AutoPlaced[] = []
  const key = (p: AutoPlaced) => (p.src ? `${p.src.line}:${p.src.col}` : '')
  // an element a loop places several parts with has no one at to write
  const many = new Set(placed.map(key).filter((k, i, all) => all.indexOf(k) !== i))
  for (const p of placed) {
    const attrs = many.has(key(p)) ? undefined : tags.get(key(p))
    const own = attrs && elementEdits(sf, attrs, p.at)
    if (own) edits.push(...own)
    else missed.push(p)
  }
  return { edits, missed }
}

const nameOf = (a: ts.JsxAttribute) => (ts.isJsxNamespacedName(a.name) ? `${a.name.namespace.text}:${a.name.name.text}` : a.name.text)

/** One element's edits: its `at` with each auto slot filled, or a new `at` for a follower that had none, and its at:* removed. */
function elementEdits(sf: ts.SourceFile, attrs: ts.JsxAttributes, at: string): TextSpan[] | null {
  const list = attrs.properties.filter(ts.isJsxAttribute)
  const own = list.find(a => nameOf(a) === 'at')
  const out: TextSpan[] = []
  if (own) {
    const lit = literalOf(own.initializer)
    if (!lit) return null
    out.push({ start: lit.getStart(sf), end: lit.getEnd(), newText: JSON.stringify(filled(lit.text, at)) })
  }
  const drop = list.filter(a => DROP.has(nameOf(a)))
  // with the space before each; a follower without at gets its new at where the first dropped prop was
  drop.forEach((a, i) => out.push({ start: a.getFullStart(), end: a.getEnd(), newText: !own && i === 0 ? ` at=${JSON.stringify(at)}` : '' }))
  return out
}

function literalOf(v: ts.JsxAttributeValue | undefined): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | null {
  if (!v) return null
  if (ts.isStringLiteral(v)) return v
  if (ts.isJsxExpression(v) && v.expression && (ts.isStringLiteral(v.expression) || ts.isNoSubstitutionTemplateLiteral(v.expression))) return v.expression
  return null
}

/** The written `at` with its auto slots taken from the placed pose; a lone auto takes all three. */
export function filled(written: string, at: string): string {
  const tokens = written.trim().split(/\s+/)
  const pose = at.split(' ')
  if (tokens.length === 1 && tokens[0] === 'auto') return at
  return tokens.map((t, i) => (t === 'auto' ? pose[i] : t)).join(' ')
}
