// The agent starters, `pcbjs mcp` and `pcbjs lsp --stdio`: the session serving a folder, started on a free loopback port when none is live.
import { findConfig } from '../project/config.js'
import { connectSession, type SessionConn } from './client.js'
import type { Role } from '@pcbjs/core/protocol'
import { real } from './paths.js'
import { ensureSession } from './start.js'

/** The `session serve` arguments for a folder: the project it is, else every project under it. */
export const starterArgs = (root: string): string[] => [...(findConfig(root) ? [] : ['--workspace', root]), '--port', '0', '--host', '127.0.0.1']

export interface Starter {
  name: string
  role: Role
  capabilities?: string[]
  log?: (line: string) => void
}

/** A connection to the session of `dir`, which this call starts when none is live. */
export async function attachSession(dir: string, o: Starter): Promise<SessionConn> {
  const root = real(dir)
  const { info, started } = await ensureSession(root, { args: starterArgs(root) })
  if (started) o.log?.(`started session ${info.session}, pid ${info.pid}, ${info.url}`)
  return connectSession(info.socket, { name: o.name, role: o.role, project: root, token: info.token, capabilities: o.capabilities ?? [] })
}
