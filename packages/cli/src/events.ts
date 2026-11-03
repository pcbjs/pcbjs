// `pcbjs events`: the session's events log as JSON lines, after a cursor, up to the first of some kinds, or followed; exit 3 without a session.
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { connect, sessionOf } from './session/thin.js'
import type { SessionEvent } from '@pcbjs/core/protocol'

export interface EventsOptions {
  root?: string
  since?: string
  wait?: boolean
  for?: string[]
  /** s */
  timeout?: number
  follow?: boolean
  scope?: string[]
  kind?: string[]
}

const line = (v: unknown) => process.stdout.write(JSON.stringify(v) + '\n')

interface Answer {
  events: SessionEvent[]
  next: string
  reset?: string
  timeout?: true
}

export async function events(o: EventsOptions): Promise<number> {
  const root = realpathSync(resolve(o.root ?? '.'))
  const info = await sessionOf(root)
  if (!info) {
    console.error(`pcbjs: no session serves ${root}; pcbjs dev or pcbjs session serve starts one`)
    return 3
  }
  const c = await connect(info, 'pcbjs events', root)
  const filter = { project: root, ...(o.kind?.length ? { kind: o.kind } : {}), ...(o.scope?.length ? { scope: o.scope } : {}) }
  if (o.follow) return follow(c, { ...filter, since: o.since, follow: true })
  try {
    const timeoutMs = ((o.timeout ?? 600) + 30) * 1000
    const a = await c.request('session/events', { ...filter, since: o.since, ...(o.wait ? { wait: true, for: o.for, timeout: o.timeout } : {}) }, timeoutMs)
    if (a.reset) line({ reset: a.reset, next: a.next })
    for (const e of a.events) line(e)
    line({ next: a.next })
    return a.timeout ? 124 : 0
  } finally {
    c.close()
  }
}

/** Every event as it comes, ending `{ "end": "<reason>" }` on Ctrl-C or when the session ends. */
async function follow(c: Awaited<ReturnType<typeof connect>>, params: Record<string, unknown>): Promise<number> {
  let reason = 'the session closed the connection'
  c.onEvent((event, data: any) => {
    if (event === 'session/event' || event === 'session/reset') line(data)
    else if (event === 'pcbjs:ide:bye') reason = String(data?.reason ?? 'the session stopped')
  })
  await c.request('session/events', params)
  return new Promise(done => {
    const stop = () => {
      reason = 'interrupted'
      c.close()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    void c.done.then(() => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      line({ end: reason })
      done(0)
    })
  })
}
