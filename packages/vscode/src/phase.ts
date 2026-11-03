// The connection phase of the workspace's sessions: the one value PcbjsServer holds, which the status bar, the panes and the editor read.
// No vscode import, so the tests load it.

import { compat, type Ready } from '@pcbjs/core/protocol'

export type Phase =
  | { kind: 'detached' }
  | { kind: 'attaching'; attempt: number }
  | { kind: 'running'; url: string; info: Ready; older: boolean }
  | { kind: 'restarting'; clearing: boolean }
  | { kind: 'reconnecting'; attempt: number }
  | { kind: 'failed'; reason: string; hint?: 'install' | 'node'; log?: string[] }

export const DETACHED: Phase = { kind: 'detached' }

/** On a session's ready; `older` when it speaks an older protocol than the extension. */
export const running = (url: string, info: Ready): Phase => ({ kind: 'running', url, info, older: compat(info) === 'older' })

/** A session is connected or being connected to; a restart is not, since it starts one when the old one ended. */
export const connected = (p: Phase): boolean => p.kind === 'attaching' || p.kind === 'running' || p.kind === 'reconnecting'
