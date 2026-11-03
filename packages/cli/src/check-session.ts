// `pcbjs check` through a live session: stdout byte for byte what a check here prints for the same inputs, the session line on stderr;
// `--watch` follows the session's findings events.
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ResolvedConfig } from './project/config.js'
import { connect, sessionLine, sessionOf } from './session/thin.js'
import type { Envelope } from '@pcbjs/core/protocol'
import type { SessionEvent } from '@pcbjs/core/protocol'

export interface SessionCheck {
  /** the entries named on the command line, none for the config's */
  entries: string[]
  verbose?: boolean
  json?: string
  watch?: boolean
}

type Checked = Envelope<{ stdout: string; exitCode: number }>

/** null when no session serves the project: the check runs here. */
export async function sessionCheck(cfg: ResolvedConfig, o: SessionCheck): Promise<number | null> {
  const root = realpathSync(cfg.root)
  const info = await sessionOf(root)
  if (!info) return null
  const c = await connect(info, 'pcbjs check', root)
  const params = { project: root, entries: o.entries.map(e => resolve(e)), verbose: !!o.verbose, ...(o.json ? { json: o.json } : {}) }
  const e = await c.request('session/check', params, 600_000)
  console.error(sessionLine(info, e))
  process.stdout.write(e.value.stdout)
  if (!o.watch) {
    c.close()
    return e.value.exitCode
  }
  console.log(`watching ${root} through session ${info.session}, Ctrl-C to stop`)
  let rewrite: NodeJS.Timeout | null = null
  c.onEvent((event, data) => {
    if (event !== 'session/event') return
    const ev = data as SessionEvent<'findings'>
    for (const l of findingsLines(ev)) console.log(l)
    // the JSON report follows the last of a burst
    if (o.json) {
      if (rewrite) clearTimeout(rewrite)
      rewrite = setTimeout(() => void c.request('session/check', params, 600_000).catch(() => {}), 300)
    }
  })
  await c.request('session/events', { project: root, follow: true, kind: ['findings'] })
  return new Promise<number>(done => {
    process.once('SIGINT', () => {
      c.close()
      done(0)
    })
    void c.done.then(() => done(0))
  })
}

/** One findings event as `check --watch` prints it: the board, the delta and the counts, then each id new and fixed. */
export function findingsLines(e: SessionEvent<'findings'>): string[] {
  const d = e.data
  const time = new Date(e.t).toLocaleTimeString()
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  return [
    `${time}  ${d.board}${d.target ? ` [${d.target}]` : ''}  ${d.added.length} new, ${d.resolved.length} fixed  ${n(d.errors, 'error')}, ${n(d.warnings, 'warning')}, ${d.unconnected} unconnected  ${d.snapshot}`,
    ...d.added.map(id => `  new    ${id}`),
    ...d.resolved.map(id => `  fixed  ${id}`),
  ]
}
