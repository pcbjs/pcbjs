// No vscode import, so the tests load it.

export const DRAFT_SOURCE = 'pcbjs draft'

interface Diag {
  source?: string
  severity?: number
  tags?: number[]
}

/** A skipped span at hint severity with the Unnecessary tag, so the editor fades it; any other diagnostic as it is. */
export function draftHint<D extends Diag>(d: D, hint: number, unnecessary: number): D {
  if (d.source !== DRAFT_SOURCE) return d
  d.severity = hint
  d.tags = [...new Set([...(d.tags ?? []), unnecessary])]
  return d
}
