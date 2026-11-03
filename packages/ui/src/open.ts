// Opening a source location: the editor through the dev server in dev, the repository host in a built site.
import type { SiteData } from '@pcbjs/core/site-data'
import { openQuery, padOf, repoUrl, sourceTarget, type SourceKind, type SourceTarget } from './source'

/** Ask the dev server to open a file in the editor. */
export async function openInEditor(t: SourceTarget): Promise<boolean> {
  try {
    return (await fetch(`/__pcbjs/open?${openQuery(t.file, t)}`)).ok
  } catch {
    return false
  }
}

/** Open a known source location; `quiet` says nothing unless opening failed. */
export async function openTarget(board: SiteData, t: SourceTarget | null, say: (text: string, err?: boolean) => void, quiet = false): Promise<void> {
  if (!t) {
    if (!quiet) say('No source location', true)
    return
  }
  if (board.dev) {
    const ok = await openInEditor(t)
    if (!ok || !quiet) say(ok ? 'Opened in editor' : `Could not open ${t.file}:${t.start[0]}`, !ok)
  } else if (board.repo) {
    window.open(repoUrl(board.repo, t.file, { start: t.start, end: t.end ?? t.start }), '_blank', 'noopener')
  } else if (!quiet) say('No source location', true)
}

/** Where an item is placed or defined, with its pad for a placement in dev. */
export function itemSource(board: SiteData, item: { id?: number | null; ref?: string | null }, kind: SourceKind = 'placement'): SourceTarget | null {
  const t = sourceTarget(board, item, kind)
  const num = t && board.dev && kind === 'placement' && item.id != null && item.ref ? padOf(board, item.id) : null
  return t && num !== null ? { ...t, pad: `${item.ref}/${num}`, board: board.name } : t
}
