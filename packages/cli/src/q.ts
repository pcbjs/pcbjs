// `pcbjs q <reference>`: the Envelope of one reference as JSON; exit 1 when it names nothing, 2 when it names several, listing them.
import { realpathSync } from 'node:fs'
import { resolveConfig } from './project/config.js'
import { answer, recordOf, type QAnswer } from './project/query.js'
import { compileHere } from './project/local.js'
import { ask, sessionLine, sessionOf } from './session/thin.js'
import type { Envelope } from '@pcbjs/core/protocol'

export interface QOptions {
  reference: string
  board?: string
  target?: string
  /** s the session waits for its compile */
  timeout?: number
  config?: string
  fresh?: boolean | 'all'
  verbose?: boolean
}

type Answer = { exit: 0; record: Record<string, unknown> } | Exclude<QAnswer, { exit: 0 }>

/** What the Envelope's value is: the record, else the error and the candidates. */
const valueOf = (a: Answer) => (a.exit === 0 ? a.record : { error: a.error, ...(a.candidates ? { candidates: a.candidates } : {}) })

function print(e: Envelope<Answer>): number {
  const a = e.value
  if (a.exit !== 0) {
    console.error(`pcbjs: ${a.error}`)
    for (const c of a.candidates ?? []) console.error(`  ${c}`)
  }
  console.log(JSON.stringify({ ...e, value: valueOf(a) }, null, 2))
  return a.exit
}

export async function q(o: QOptions): Promise<number> {
  const cfg = await resolveConfig([], 'build', o.config, undefined, () => {})
  const root = realpathSync(cfg.root)
  const info = o.fresh ? null : await sessionOf(root)
  if (info) {
    const e = await ask(info, 'pcbjs q', root, 'session/q', { project: root, reference: o.reference, board: o.board, target: o.target, timeout: o.timeout })
    console.error(sessionLine(info, e))
    return print(e as Envelope<Answer>)
  }
  const here = await compileHere(cfg, { verbose: o.verbose, fresh: o.fresh })
  for (const l of here.errors) console.error(l)
  const a = answer(here.boards, o.reference, { board: o.board, target: o.target })
  return print({ snapshot: here.snapshot, stale: null, overlay: [], value: a.exit === 0 ? { exit: 0, record: recordOf(a) } : a })
}
