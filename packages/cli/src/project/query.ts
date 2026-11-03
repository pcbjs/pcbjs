// The boards of one snapshot as the board API sees them, and `pcbjs q` over them: one reference, its record, or the candidates of an ambiguous one.
import { boardApi, type Board, type Entity } from '@pcbjs/compile/query'
import { variantSlug } from '@pcbjs/core/internal/variants'
import { RefError } from '@pcbjs/core/ref'
import type { Finding } from '@pcbjs/export/internal/findings'
import type { BoardOut } from './project.js'
import type { ReportSlot } from './report.js'

export interface QBoard {
  name: string
  target: string | null
  entry: string
  compiled: BoardOut
  findings: Finding[]
  api: Board
}

/** Every compiled board and target of the slots, each with its API; `findings` gives a board's findings with their ids. */
export function snapshotBoards(slots: ReportSlot[], snapshot: string, root: string, findings: (c: BoardOut) => Finding[]): QBoard[] {
  return slots
    .filter(s => s.compiled && !s.conflict)
    .flatMap(s => s.compiled!)
    .map(c => {
      const f = findings(c)
      return {
        name: c.board.name,
        target: c.board.variant?.name ?? null,
        entry: c.entry.rel,
        compiled: c,
        findings: f,
        api: boardApi({ board: c.board, findings: f, snapshot, root }),
      }
    })
}

const targetIs = (b: QBoard, want: string) => b.target === want || (b.target !== null && variantSlug(b.target) === want)

/** One board per name: the target asked for, else the first; a name or target that matches none is an error. */
export function pickBoards(all: QBoard[], o: { board?: string; target?: string } = {}): QBoard[] {
  const names = [...new Set(all.map(b => b.name))]
  if (o.board && !names.includes(o.board)) throw new RefError(`no board ${o.board}; boards: ${names.join(', ')}`)
  const out: QBoard[] = []
  for (const n of o.board ? [o.board] : names) {
    const of = all.filter(b => b.name === n)
    const hit = o.target ? of.find(b => targetIs(b, o.target!)) : of[0]
    if (hit) out.push(hit)
    else if (o.board) throw new RefError(`no target ${o.target} of ${n}; targets: ${of.map(b => b.target).join(', ')}`)
  }
  return out
}

export type QAnswer = { exit: 0; board: QBoard; entity: Entity } | { exit: 1; error: string; candidates?: string[] } | { exit: 2; error: string; candidates: string[] }

/** `board:<name>/…` names its board; otherwise every board is asked and only one may answer. */
export function answer(all: QBoard[], reference: string, o: { board?: string; target?: string } = {}): QAnswer {
  const m = /^board:([^/]+)(?:\/(.*))?$/.exec(reference)
  const board = m ? m[1] : o.board
  const rest = m ? (m[2] ?? '') : reference
  let boards: QBoard[]
  try {
    boards = pickBoards(all, { board, target: o.target })
  } catch (e) {
    return { exit: 1, error: String((e as Error).message) }
  }
  if (!rest) return { exit: 1, error: `${reference}: names the board only` }
  const found: { board: QBoard; entity: Entity }[] = []
  const several: string[] = []
  for (const b of boards) {
    try {
      const e = b.api.resolve(rest)
      if (e) found.push({ board: b, entity: e })
    } catch (e) {
      if (!(e instanceof RefError)) throw e
      const list = /names several: (.*)$/.exec(e.message)?.[1]
      if (!list) return { exit: 1, error: e.message }
      several.push(...list.split(', ').map(p => (boards.length > 1 ? `board:${b.name}/${p}` : p)))
    }
  }
  const candidates = [...several, ...(found.length > 1 || several.length ? found.map(f => `board:${f.board.name}/${f.entity.ref}`) : [])]
  if (candidates.length) return { exit: 2, error: `${reference} names several; give one of them${boards.length > 1 ? ' or --board' : ''}`, candidates }
  if (!found.length) return { exit: 1, error: `${reference}: names nothing on ${boards.map(b => b.name).join(', ') || 'any board'}` }
  return { exit: 0, ...found[0] }
}

/** The record `q` prints: the entity's, with its board and target. */
export const recordOf = (a: Extract<QAnswer, { exit: 0 }>): Record<string, unknown> => ({ ...(a.entity.toJSON() as object), board: a.board.name, target: a.board.target })
