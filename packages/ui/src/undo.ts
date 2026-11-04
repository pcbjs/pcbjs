// Standalone undo and redo use session history; native document history is handled by the editor.
import type { EditResult, ScopesMsg } from '@pcbjs/core/protocol'

export interface EditStep {
  txn: string
}
export interface Steps {
  done: EditStep[]
  undone: EditStep[]
}
/** Standalone history is owned by the session. */
export interface UndoPorts {
  session(txn: string, redo: boolean): Promise<EditResult>
}

export const undoKey = (board: string, project?: string): string => `${project ?? ''}\0${board}`

/** The current project's root, when the workspace identifies it. */
export function undoProject(scopes: ScopesMsg | null, scope: string | null): string | undefined {
  return scopes?.scopes.find(s => s.slug === scope)?.root ?? (scopes?.single ? scopes.scopes[0]?.root : undefined)
}

/** A commit as a step to undo, null when it wrote nothing. */
export function stepOf(r: EditResult): EditStep | null {
  const files = r.written.filter(w => w.applied)
  if (!r.txn || r.error || !files.length) return null
  return { txn: r.txn }
}

/** A commit made from this page: the step on top, the redo list cleared. */
export function pushStep(s: Steps, r: EditResult): void {
  const step = stepOf(r)
  if (!step) return
  s.done.push(step)
  s.undone.length = 0
}

/** The step on top undone, or redone: false when there is none, else the error that kept it, or null when it moved. */
export function undoStep(s: Steps, redo: boolean, ports: UndoPorts): false | Promise<string | null> {
  const from = redo ? s.undone : s.done
  const step = from[from.length - 1]
  if (!step) return false
  const moved = () => {
    from.pop()
    ;(redo ? s.done : s.undone).push(step)
  }
  return ports.session(step.txn, redo).then(
    r => {
      if (r.error) return r.error
      moved()
      return null
    },
    (e: unknown) => String((e as Error)?.message ?? e),
  )
}
