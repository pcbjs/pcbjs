// The code actions: freeze the auto placement of a file, and name a part that has none with the next ref its prefix leaves free on the compiled boards.

import type { CodeAction } from 'vscode-languageserver/node.js'
import type { Range } from '@pcbjs/core/protocol'
import { toSite } from '@pcbjs/core/internal/textdoc'
import type { DocModel } from './doc.js'
import { keyOf, type FileFacts } from './facts.js'
import { extractPart } from './names.js'
import type { Projects } from './project.js'

/** The edits that freeze the auto placement of a file's parts, and the 1-based lines of their elements. */
export type Placements = { lines: number[]; edits: { start: number; end: number; newText: string }[] } | null | undefined

/** `Freeze the auto placement` on a line of a part with an auto slot: every such part of the file gets its `at`. */
export function freezeAction(uri: string, doc: DocModel, range: Range, placements: Placements): CodeAction[] {
  if (!placements?.edits.length || !placements.lines.some(l => l - 1 >= range.start.line && l - 1 <= range.end.line)) return []
  const edits = placements.edits.map(e => doc.edit(e))
  return [{ title: 'Freeze the auto placement of this file', kind: 'refactor.rewrite', edit: { changes: { [uri]: edits } } }]
}

/** A part with no name extracted to a constant whose name is its ref: the prefix from the part the last compile made there, every ref the boards hold taken but its own. */
export function extractAction(uri: string, doc: DocModel, f: FileFacts, code: Projects, range: Range): CodeAction[] {
  const file = doc.file
  try {
    const program = code.program(file)
    if (!program) return []
    const parts = f.all.flatMap(b => b.site.schematic.parts.map(part => ({ part, here: !!part.src && part.src.file === keyOf(b.root, file) })))
    const at = (line: number) => parts.find(x => x.here && x.part.src!.line === line)?.part
    const prefix = (call: { getStart(): number }) => at(doc.site(code.toSource(file, call.getStart())).line)?.prefix
    const own = at(toSite(range.start).line)?.ref
    const taken = parts.map(x => x.part.ref).filter(r => r !== own)
    const x = extractPart(program, file, code.toInjected(file, doc.offset(range.start)), prefix, taken)
    if (!x) return []
    const edits = x.edits.map(e => ({ range: doc.range({ start: code.toSource(file, e.start), end: code.toSource(file, e.end) }), newText: e.newText }))
    return [{ title: x.title, kind: 'refactor.extract', edit: { changes: { [uri]: edits } } }]
  } catch {
    return []
  }
}
