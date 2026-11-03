// Go to definition and the document highlight, both read from the source ranges the boards drew.

import { resolve } from 'node:path'
import type { DocumentHighlight, Location } from 'vscode-languageserver/node.js'
import type { Position } from '@pcbjs/core/protocol'
import { toRange, type Site } from '@pcbjs/core/internal/textdoc'
import type { DocModel } from './doc.js'
import { contains, keyOf, lspRange, type FileFacts } from './facts.js'
import { toUri } from './host.js'
import { innermost } from './segments.js'

const TEXT = 1
const READ = 2

/** The innermost range at a position, and the other ranges of the file that drew any of its items or parts. */
export function highlights(f: FileFacts, p: Position): DocumentHighlight[] {
  const at = f.rangeAt(p)
  if (!at) return []
  const out: DocumentHighlight[] = [{ range: lspRange(at.range), kind: TEXT }]
  const ids = new Set(at.range.uids)
  const refs = new Set(at.range.refs)
  for (const r of at.ranges) {
    if (r === at.range || contains(r, at.range) || contains(at.range, r)) continue
    if (r.uids.some(i => ids.has(i)) || r.refs.some(x => refs.has(x))) out.push({ range: lspRange(r), kind: READ })
  }
  return out
}

/** A pad reference goes to the placement of its part, of every instance of a layout placed several times; a placement to its definition; anything else inside a footprint to its placement. */
export function definitions(f: FileFacts, doc: DocModel | undefined, p: Position): Location[] {
  if (doc) {
    const hit = innermost(doc.hits(f.helpers(doc)), doc.offset(p))
    if (hit?.kind === 'pinRef') {
      const locs = f.parts(hit.context.ref ?? '').flatMap(({ fp, root }) => (fp.src ? [location(resolve(root, fp.src.file), fp.src)] : []))
      if (locs.length) return unique(locs)
    }
  }
  const at = f.rangeAt(p)
  if (!at) return []
  const out: Location[] = []
  const [line, col] = at.range.start
  for (const ref of at.range.refs) {
    const fp = at.ref.site.footprints.find(x => x.ref === ref)
    if (!fp?.src) continue
    const atPlacement = keyOf(at.ref.root, f.file) === fp.src.file && fp.src.line === line && fp.src.col === col
    if (atPlacement && fp.def) out.push(location(resolve(at.ref.root, fp.def.file), fp.def))
    else if (!atPlacement) out.push(location(resolve(at.ref.root, fp.src.file), fp.src))
  }
  return unique(out)
}

function location(file: string, s: Site): Location {
  return { uri: toUri(file), range: toRange(s) }
}

function unique(ls: Location[]): Location[] {
  const seen = new Set<string>()
  return ls.filter(l => {
    const k = `${l.uri}:${l.range.start.line}:${l.range.start.character}`
    return !seen.has(k) && !!seen.add(k)
  })
}
