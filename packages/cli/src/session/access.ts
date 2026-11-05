import type { IncomingMessage } from 'node:http'
import { localRequest } from '../server/access.js'
export { isLoopback, localRequest, sessionFileDeny } from '../server/access.js'
import { modeOf } from './clients.js'
import type { EditMode } from './frames.js'

export function requestMode(req: IncomingMessage, policy: { edit: EditMode; token?: string }) {
  const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1]
  const token = bearer ?? new URL(req.url ?? '/', 'http://local').searchParams.get('token') ?? undefined
  return modeOf({ kind: 'tcp', loopback: localRequest(req) }, policy.edit, policy.token, token)
}
