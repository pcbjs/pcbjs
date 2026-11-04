// A route end slot's completions, the ends the views annotate with the same labels, and the item in focus the views light as a hover.

import { CompletionItemKind, type CompletionItem } from 'vscode-languageserver/node.js'
import type { ProjectAssist } from './host.js'
import type { DocModel } from './doc.js'
import { endCompletions } from './assist.js'

/** ms a completion focus outlives a cursor move or an edit in its slot without another resolve */
export const FOCUS_LAPSE_MS = 1000

interface EndData {
  file: string
  handle: string
  projects: { project: string; board: string }[]
}

/** The completion items of a slot, the first end's net first. */
export function endItems(doc: DocModel, contexts: ProjectAssist[]): CompletionItem[] {
  return endCompletions(doc.text, contexts).map((c, i): CompletionItem => ({
    label: c.handle,
    labelDetails: { description: c.label },
    detail: c.label,
    kind: c.kind === 'pad' ? CompletionItemKind.Reference : CompletionItemKind.Value,
    sortText: String(i).padStart(5, '0'),
    filterText: c.edit.newText,
    preselect: i === 0 || undefined,
    textEdit: doc.edit(c.edit),
    data: {
      end: {
        file: doc.file,
        handle: c.handle,
        projects: contexts.flatMap(a => (a.ends?.candidates.some(k => k.handle === c.handle) ? [{ project: a.project, board: a.board }] : [])),
      } satisfies EndData,
    },
  }))
}

type Send = (file: string, focus: { project: string; board: string; handle: string }[] | null) => void

/** The item in focus: the one the editor resolved last, lapsing a second after the cursor or the text moved unless another resolve arrives, since the editor tells no close of its list. */
export function endFocus(send: Send) {
  let focused: { file: string } | null = null
  let lapse: ReturnType<typeof setTimeout> | undefined
  const unfocus = (now: boolean) => {
    const f = focused
    if (!f) return
    clearTimeout(lapse)
    const clear = () => {
      if (focused !== f) return
      focused = null
      send(f.file, null)
    }
    if (now) clear()
    else lapse = setTimeout(clear, FOCUS_LAPSE_MS)
  }
  return {
    resolved(item: CompletionItem) {
      const end = (item.data as { end?: EndData } | undefined)?.end
      if (!end || !Array.isArray(end.projects) || end.projects.some(p => typeof p.project !== 'string' || typeof p.board !== 'string')) return
      clearTimeout(lapse)
      if (focused && focused.file !== end.file) send(focused.file, null)
      focused = end
      send(
        end.file,
        end.projects.map(p => ({ ...p, handle: end.handle })),
      )
    },
    /** the cursor moved in `file`, still in a slot or not */
    moved(file: string, inSlot: boolean) {
      if (focused) unfocus(!inSlot || focused.file !== file)
    },
    /** the text of `file` changed */
    edited(file: string | undefined) {
      if (focused?.file === file) unfocus(false)
    },
    dispose: () => unfocus(true),
  }
}
