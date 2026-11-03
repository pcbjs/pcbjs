// Which attached session serves a file: the language client gate, the document handoff, the cursor sync, requests about a file and
// the fab check all ask this one function. No vscode import, so the tests load it.

import { isUnder, samePath } from './protocol'

export interface Owner<L> {
  link: L
  /** the deepest root of the link that holds the file */
  root: string
}

const within = (root: string, file: string): boolean => samePath(root, file) || isUnder(root, file)

/** The link with the deepest root holding `file`, a path inside one of the workspace folders; a root itself counts as held. */
export function ownerOf<L extends { readonly roots: string[] }>(file: string, folders: readonly string[], links: readonly L[]): Owner<L> | undefined {
  if (!folders.some(f => within(f, file))) return undefined
  let best: Owner<L> | undefined
  for (const link of links) for (const root of link.roots) if (within(root, file) && (!best || root.length > best.root.length)) best = { link, root }
  return best
}
