// The tools' requests to the session, free of Vue and the DOM: `session/edit/*` and `session/select` over the page's transport, and the
// banner when the session speaks another protocol; see docs/editing.md.
import { MAJOR, TOOLS, compat, type EditModeMsg, type EditPlan, type EditResult, type EditUpdate, type Params, type ReadyInfo, type Tool } from '@pcbjs/core/protocol'
import type { Transport } from './transport'

/** The banner when the session is older than the viewer, or speaks another major; null when it does not. */
export function sessionMismatch(r: Partial<Pick<ReadyInfo, 'version' | 'protocol' | 'major'>>): string | null {
  const c = compat(r)
  const version = r.version || '(unknown version)'
  if (c === 'same' || c === 'newer') return null
  if (c === 'incompatible' && (r.major ?? 0) > MAJOR) return `session ${version} speaks a newer protocol than the viewer, reload the page`
  return `session ${version} is older than the viewer, restart it`
}

/** The tools a node's capabilities allow. */
export const toolsOf = (caps: readonly string[]): Tool[] => TOOLS.filter(t => caps.includes(t.needs))

/** Why the anchor takes no tools, the note under the chip: `read-only`, the computed `at` of an instance, `no placement` for a part, an instance, a route, a text or a graphic without one, `select a part` for anything else; null when it takes some, nothing is selected or the page has no session. */
/** The chip's Open placement and Open definition buttons: only with no editor attached, where a click and an alt-click cannot jump one. */
export const jumpButtons = (mode: Pick<EditModeMsg, 'editor'> | null): boolean => !mode?.editor

export function toolsWhy(
  kind: string | null,
  node: { caps: readonly string[]; computed?: boolean; owned?: string } | null,
  mode: EditModeMsg | null,
  isolated = false,
): string | null {
  if (!kind || !mode) return null
  if (mode.mode === 'ro') return 'read-only'
  if (isolated && node?.owned) return `its own placement in ${node.owned} keeps it; the definition is not written`
  if (node && toolsOf(node.caps).length) return null
  if (node?.computed) return 'its at is computed; set it in the source'
  return ['part', 'group', 'route', 'pt', 'leg', 'item'].includes(kind) ? 'no placement' : 'select a part'
}

/** The chip's confirmation of a write: the files, and where they went, `Written quad.pcb.tsx in the editor`. */
export function writtenText(files: { file: string; via: 'editor' | 'disk' }[]): string {
  const names = files.map(f => f.file.split('/').pop()).join(', ')
  return `Written ${names} ${files.every(f => f.via === 'editor') ? 'in the editor' : 'to disk'}`
}

type Written = { file: string; via: 'editor' | 'disk' }[]

export interface EditOwner {
  board: string
  project?: string
}

/** The tools' requests; `onCommit` sees every commit's result, `onWritten` the files each commit, undo or redo wrote. */
export function editClient(t: Transport, onCommit?: (r: EditResult, owner?: EditOwner) => void, onWritten?: (files: Written) => void, ownerOf?: (board: string) => EditOwner) {
  const owners = new Map<string, EditOwner>()
  const wrote = (r: EditResult) => {
    const files = (r.written ?? []).filter(w => w.applied).map(w => ({ file: w.file, via: w.via }))
    if (files.length) onWritten?.(files)
    return r
  }
  return {
    begin: (p: Params<'session/edit/begin'>) => {
      const owner = ownerOf?.(p.board) ?? { board: p.board }
      return t.request('session/edit/begin', p.run ? p : { ...p, run: undefined }).then(r => {
        owners.set(r.txn, owner)
        return r
      })
    },
    update: (txn: string, u: EditUpdate) => t.request('session/edit/update', { txn, ...u }),
    commit: (txn: string) =>
      t.request('session/edit/commit', { txn }).then(r => {
        onCommit?.(r, owners.get(txn))
        owners.delete(txn)
        return wrote(r)
      }),
    cancel: (txn: string) => {
      owners.delete(txn)
      return t.request('session/edit/cancel', { txn })
    },
    /** the session's undo, or redo, of a commit this page made */
    undo: (txn: string, redo: boolean) => t.request(redo ? 'session/edit/redo' : 'session/edit/undo', { txn }).then(wrote),
    /** the board's entry in the editor, the cursor on its `<PCB` and focus kept in the page */
    openEntry: (board: string) => t.request('session/select', { board, refs: [`board:${board}`] }),
  }
}
export type EditClient = ReturnType<typeof editClient>

/** One drag as a transaction: begun once, an update per new snapped value, then commit or cancel; one update in flight, the newest waiting one replacing any older. */
export function dragTxn(c: EditClient, begin: Parameters<EditClient['begin']>[0], onPlan: (p: EditPlan) => void) {
  const started = c.begin(begin)
  let last = ''
  let done = false
  let next: EditUpdate | null = null
  let flight: Promise<void> | null = null
  const send = () => {
    if (flight || !next) return
    const u = next
    next = null
    flight = started
      .then(t => c.update(t.txn, u))
      .then(onPlan)
      .catch(() => undefined)
      .then(() => {
        flight = null
        send()
      })
  }
  const settled = async () => {
    while (flight) await flight
  }
  return {
    update(u: EditUpdate) {
      const key = JSON.stringify(u)
      if (done || key === last) return
      last = key
      next = u
      send()
    },
    async commit(): Promise<EditResult> {
      done = true
      const t = await started
      await settled()
      return c.commit(t.txn)
    },
    async cancel(): Promise<void> {
      done = true
      next = null
      const t = await started.catch(() => null)
      if (t) await c.cancel(t.txn)
    },
    started,
  }
}
export type DragTxn = ReturnType<typeof dragTxn>
