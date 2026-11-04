// The CLI's source writes, `place --write`, `patch hold` and `model add --write`: through the live session's `session/write` when one
// serves the project, so an editor's buffer takes them, else on disk.
import { realpathSync } from 'node:fs'
import type { Written } from '@pcbjs/core/protocol'
import { diffEdit, type Span } from '@pcbjs/core/internal/textdoc'
import { connect, sessionOf } from './thin.js'
import { writeText } from './write.js'

export interface SourceWriter {
  /** the file's text `after` in place of `before`, the text it was computed on, null for a new file */
  write(file: string, before: string | null, after: string): Promise<Written>
  close(): void
}

/** The span of `text` holding the change to `to`, grown by whole lines until it occurs once, so it anchors the edit wherever the file moved. */
export function anchor(text: string, to: string): { old: string; new: string } {
  const d = diffEdit(text, to)
  const s: Span = { start: d.start, end: d.end }
  const once = () => s.end > s.start && text.indexOf(text.slice(s.start, s.end)) === s.start && text.indexOf(text.slice(s.start, s.end), s.start + 1) < 0
  while (!once() && (s.start > 0 || s.end < text.length)) {
    s.start = s.start > 0 ? text.lastIndexOf('\n', s.start - 2) + 1 : 0
    let nl = text.indexOf('\n', s.end)
    if (nl === s.end) nl = text.indexOf('\n', s.end + 1)
    s.end = nl < 0 ? text.length : nl
  }
  return { old: text.slice(s.start, s.end), new: to.slice(s.start, to.length - (text.length - s.end)) }
}

function onDisk(file: string, text: string): Written {
  writeText(file, text)
  return { file, via: 'disk', applied: true }
}

/** The writer of a project: its session's while one is live, else the disk's. */
export async function sourceWriter(root: string, name: string): Promise<SourceWriter> {
  const real = realpathSync.native(root)
  const info = await sessionOf(real)
  if (!info) return { write: async (file, _, after) => onDisk(file, after), close: () => {} }
  const c = await connect(info, name, real)
  return {
    write: (file, before, after) => c.request('session/write', before === null ? { file, text: after } : { file, edits: [anchor(before, after)] }),
    close: () => c.close(),
  }
}
