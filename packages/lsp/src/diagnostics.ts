// The diagnostics of every file: name hints, the boards' findings, the spans a draft skipped, shadowed files and unknown units.

import type { Diagnostic } from 'vscode-languageserver/node.js'
import { toRange } from '@pcbjs/core/internal/textdoc'
import type { DocModel } from './doc.js'
import type { Marker } from './facts.js'
import type { Range } from '@pcbjs/core/protocol'
import { toUri } from './host.js'

const ERROR = 1
const WARNING = 2
const INFO = 3
const HINT = 4
const UNNECESSARY = 1

export interface DiagnosticsInput {
  /** the open documents by URI */
  docs: Map<string, DocModel>
  /** every board's findings */
  markers: Marker[]
  /** the ref style hints of a design file, offsets in its text */
  names(doc: DocModel): { start: number; end: number; message: string }[]
  /** the spans a draft preview skipped, per file */
  skipped: { file: string; ranges: Range[] }[]
  /** files the session compiles from an editor's text over a newer disk */
  shadowed: { file: string; message: string }[]
}

/** Every file's diagnostics by URI; each open document has its entry, empty when clean, so a client sees that the check ran. */
export function diagnostics(i: DiagnosticsInput): Map<string, Diagnostic[]> {
  const out = new Map<string, Diagnostic[]>()
  const put = (uri: string, d: Diagnostic) => {
    const list = out.get(uri) ?? []
    list.push(d)
    out.set(uri, list)
  }
  for (const [uri, doc] of i.docs)
    if (/\.[cm]?tsx?$/.test(doc.file))
      for (const h of names(i, doc)) put(uri, { range: doc.range(h), severity: HINT, source: 'pcbjs names', code: 'ref-style', message: h.message })
  for (const m of i.markers) put(toUri(m.file), finding(m))
  for (const s of i.skipped)
    for (const range of s.ranges) put(toUri(s.file), { range, severity: HINT, tags: [UNNECESSARY], source: 'pcbjs draft', message: 'skipped in the preview: a syntax error' })
  const at = { line: 0, character: 0 }
  for (const s of i.shadowed) put(toUri(s.file), { range: { start: at, end: at }, severity: WARNING, source: 'pcbjs session', code: 'shadowed', message: s.message })
  // a unit the compiler does not know, at its token
  for (const [uri, doc] of i.docs)
    if (/\.[cm]?[jt]sx?$/.test(doc.file))
      for (const b of doc.units().bad) put(uri, { range: doc.range(b), severity: ERROR, source: 'pcbjs', code: 'unknown-unit', message: b.message })
  for (const uri of i.docs.keys()) if (!out.has(uri)) out.set(uri, [])
  return out
}

const names = (i: DiagnosticsInput, doc: DocModel) => {
  try {
    return i.names(doc)
  } catch {
    return []
  }
}

function finding(m: Marker): Diagnostic {
  return {
    // only the first line of a long range, so a finding on a whole element does not paint it all
    range: toRange(m.endLine === m.line ? m : { line: m.line, col: m.col }),
    severity: m.severity === 'error' ? ERROR : m.severity === 'info' ? INFO : WARNING,
    source: `pcbjs ${m.kind}`,
    code: m.rule,
    message: m.target ? `${m.message} (${m.target})` : m.message,
  }
}
