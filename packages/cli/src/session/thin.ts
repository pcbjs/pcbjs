// One-shot commands as thin clients: with a live session and no --fresh they ask it over the socket; the line naming the session goes to stderr.
import { connectSession, type SessionConn } from './client.js'
import { liveSession } from './start.js'
import type { SessionInfo } from './frames.js'
import type { Envelope, Method, Params, Result } from '@pcbjs/core/protocol'

/** The live session serving the project, null when none: the command runs in process and starts none. */
export const sessionOf = (root: string): Promise<SessionInfo | null> => liveSession(root)

export function connect(info: SessionInfo, name: string, root: string): Promise<SessionConn> {
  return connectSession(info.socket, { name, role: 'cli', project: root, token: info.token })
}

/** One request on a connection of its own. */
export async function ask<M extends Method>(info: SessionInfo, name: string, root: string, method: M, params: Params<M>, timeoutMs = 600_000): Promise<Result<M>> {
  const c = await connect(info, name, root)
  try {
    return await c.request(method, params, timeoutMs)
  } finally {
    c.close()
  }
}

/** `session <id>  snapshot <id>`, the unsaved text it compiled and why it is stale. */
export function sessionLine(info: Pick<SessionInfo, 'session'>, e: Pick<Envelope<unknown>, 'snapshot' | 'overlay' | 'stale'>): string {
  const overlay = e.overlay.length ? `  with the unsaved text of ${e.overlay.join(', ')}` : ''
  const stale = e.stale ? `  stale: ${e.stale.reason}${e.stale.current ? `, now ${e.stale.current}` : ''}` : ''
  return `session ${info.session}  snapshot ${e.snapshot}${overlay}${stale}; --fresh compiles here`
}
