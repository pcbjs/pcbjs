// The text of a patches file: a patch() call added to its default export, or one of the same operation on the same ref replaced; see docs/patches.md.
import ts from 'typescript'
import type { Patch } from '@pcbjs/core/internal/patch'

/** The patches file with `p` in it: a patch of the same operation on the same ref replaced, else appended to the default export. */
export function withPatch(text: string | null, p: Patch): string {
  const call = patchText(p)
  if (text === null) return `import { patch } from '@pcbjs/core'\n\nexport default [\n${call},\n]\n`
  const sf = ts.createSourceFile('patches.ts', text, ts.ScriptTarget.Latest, true)
  const list = defaultList(sf)
  if (!list) throw new Error('the patches file must export default a list of patch() calls, export default [ … ]')
  const kind = Object.keys(p.op)[0]
  const same = list.elements.find(e => ts.isCallExpression(e) && sameTarget(e, p.ref, kind))
  if (same) return text.slice(0, same.getStart(sf)) + call.trimStart() + text.slice(same.getEnd())
  const last = list.elements.at(-1)
  if (!last) return text.slice(0, list.getStart(sf) + 1) + `\n${call},\n` + text.slice(list.getEnd() - 1)
  const end = list.elements.hasTrailingComma ? text.indexOf(',', last.getEnd()) + 1 : last.getEnd()
  return text.slice(0, end) + `${list.elements.hasTrailingComma ? '' : ','}\n${call},` + text.slice(end)
}

function defaultList(sf: ts.SourceFile): ts.ArrayLiteralExpression | null {
  for (const st of sf.statements) {
    if (!ts.isExportAssignment(st) || st.isExportEquals) continue
    let e = st.expression
    while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression
    return ts.isArrayLiteralExpression(e) ? e : null
  }
  return null
}

/** `patch('<ref>', { <kind>: … }, …)` */
function sameTarget(e: ts.CallExpression, ref: string, kind: string): boolean {
  const [r, op] = e.arguments
  if (!ts.isIdentifier(e.expression) || e.expression.text !== 'patch' || !r || !ts.isStringLiteralLike(r) || r.text !== ref) return false
  return !!op && ts.isObjectLiteralExpression(op) && op.properties.some(q => q.name && ts.isIdentifier(q.name) && q.name.text === kind)
}

const str = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** The patch call, two-space indented, one track or via per line. */
export function patchText(p: Patch): string {
  const v = (x: unknown): string =>
    typeof x === 'string'
      ? str(x)
      : Array.isArray(x)
        ? `[${x.map(v).join(', ')}]`
        : x && typeof x === 'object'
          ? `{ ${Object.entries(x)
              .map(([k, y]) => `${k}: ${v(y)}`)
              .join(', ')} }`
          : String(x)
  const op = p.op
  if (!('hold' in op)) return `  patch(${str(p.ref)}, ${v(op)}, ${str(p.hash)})`
  const h = op.hold
  const rows = (list: object[]) => (list.length ? `[\n${list.map(x => `          ${v(x)},\n`).join('')}        ]` : '[]')
  return [
    `  patch(`,
    `    ${str(p.ref)},`,
    `    {`,
    `      hold: {`,
    ...(h.snapshot ? [`        snapshot: ${str(h.snapshot)},`] : []),
    `        tracks: ${rows(h.tracks)},`,
    `        vias: ${rows(h.vias)},`,
    `      },`,
    `    },`,
    `    ${str(p.hash)},`,
    `  )`,
  ].join('\n')
}
