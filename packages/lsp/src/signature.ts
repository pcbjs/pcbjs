// Pad access is a one-parameter operation even while the TypeScript parser recovers an empty or unfinished index.
import ts from 'typescript'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { SignatureHelp } from 'vscode-languageserver/node.js'
import { partTarget, type TargetBoard } from './target.js'
import { renderPreview } from './preview.js'

/** The exact element accessor containing the caret, including the boundary immediately before its closing bracket. */
export function padAccessor(sf: ts.SourceFile, offset: number): { receiver: ts.Expression; current: string } | undefined {
  let found: { receiver: ts.Expression; current: string } | undefined
  const visit = (node: ts.Node) => {
    if (offset < node.getFullStart() || offset > node.getEnd()) return
    if (ts.isElementAccessExpression(node)) {
      const tail = sf.text.slice(node.expression.getEnd(), node.getEnd())
      const bracket = /^\s*\[/.exec(tail)
      if (bracket) {
        const open = node.expression.getEnd() + bracket[0].length - 1
        const close = node.getChildren(sf).find(n => n.kind === ts.SyntaxKind.CloseBracketToken)?.getStart(sf) ?? node.getEnd()
        if (offset > open && offset <= close) {
          const value = sf.text.slice(open + 1, close).trim()
          if (/^(?:\d*|"(?:[^"\\\r\n]|\\.)*"?|'(?:[^'\\\r\n]|\\.)*'?)$/.test(value)) {
            const current = ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : value.replace(/^["']|["']$/g, '')
            found = { receiver: node.expression, current }
          }
        }
      }
    }
    node.forEachChild(visit)
  }
  sf.forEachChild(visit)
  return found
}

/** Standard signature help; ordinary arrays and unresolved/shadowed names produce no pcbjs hint. */
export function padSignature(program: ts.Program, file: string, offset: number, boards: TargetBoard[]): SignatureHelp | null {
  const sf = program.getSourceFile(file)
  const accessor = sf && padAccessor(sf, offset)
  if (!sf || !accessor) return null
  // Keep the actual rooted snapshot paired with resolution: board names can repeat across projects.
  for (const candidate of boards) {
    const rel = relative(candidate.root, file)
    const inside = !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)
    const recordsFile = Object.keys(candidate.site.sources ?? {}).some(path => resolve(candidate.root, path) === file) || candidate.site.schematic.parts.some(part => part.src && resolve(candidate.root, part.src.file) === file)
    if (!inside && !recordsFile) continue
    const target = partTarget(program, accessor.receiver, [candidate])
    const ref = target?.boards[0]?.parts[0]
    const site = candidate.site
    const fp = site.footprints.find(fp => fp.ref === ref)
    if (!ref || !fp) continue
    const selected = fp.pads.find(p => p.num === accessor.current || p.name === accessor.current)
    const preview = renderPreview(site, { frame: ref, pads: selected ? [selected.num] : [] })
    if (!preview) continue
    const receiver = accessor.receiver.getText(sf)
    const choices = [...new Set(fp.pads.map(p => p.num))]
    const details = [`![Footprint pads](${preview.uri})`, `**Footprint orientation** · ${ref} · pads: ${choices.map(p => `\`${p.replace(/`/g, '')}\``).join(', ')}`].join('\n\n')
    return {
      signatures: [{ label: `${receiver}[pad]`, documentation: { kind: 'markdown', value: details }, parameters: [{ label: [receiver.length + 1, receiver.length + 4], documentation: 'Pad number or pin name on this footprint.' }], activeParameter: 0 }],
      activeSignature: 0,
      activeParameter: 0,
    }
  }
  return null
}
