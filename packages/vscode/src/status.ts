// The status bar item from the phase, what is installed, the draft holding the compile, the board count and cursor sync. No vscode
// import, so the tests load it.

import type { Phase } from './phase'
import { versionStatus, type Installed } from './version'
import { holdStatus, type Hold } from './drafts'

export interface Status {
  text: string
  tooltip: string
  command: string
  tone?: 'error' | 'warning'
}

const HOLD_LINE = 'The edit compiles once its block is clean, the cursor leaves it or the file is saved.'

function phaseLines(p: Phase): string[] {
  if (p.kind === 'running')
    return [
      `session ${p.info.session}, pid ${p.info.pid}, ${p.url}`,
      ...(p.older ? [`The session runs pcbjs ${p.info.version}, older than the extension; restart it to use every feature.`] : []),
    ]
  if (p.kind === 'failed') return [`failed: ${p.reason}`, ...(p.log ?? []).map(l => `  ${l}`)]
  if (p.kind === 'attaching' || p.kind === 'reconnecting') return [p.attempt ? `${p.kind}, attempt ${p.attempt}` : p.kind]
  if (p.kind === 'restarting') return [p.clearing ? 'restarting, clearing caches' : 'restarting']
  return ['detached']
}

function textOf(p: Phase, label: string, holding: string | null, older: boolean, plain: string): string {
  if (p.kind === 'restarting') return `$(sync~spin) ${label}: restarting${p.clearing ? ', clearing caches' : ''}`
  if (holding) return holding
  if (p.kind === 'attaching' || p.kind === 'reconnecting') return `$(sync~spin) ${label}: ${p.kind}`
  if (older) return `$(warning) ${label}: older session`
  return plain
}

export function statusOf(p: Phase, inst: Installed, hold: Hold | undefined, boards: number, cursorSync: boolean): Status {
  const run = p.kind === 'running'
  const v = versionStatus(inst, run ? `${boards} board${boards === 1 ? '' : 's'}` : null)
  const label = inst.version ? `pcbjs ${inst.version}` : 'pcbjs'
  const holding = run ? holdStatus(hold) : null
  const failed = p.kind === 'failed' && !!inst.version
  const older = run && p.older && !holding && !v.command
  const plain = failed ? `$(error) ${label}: failed` : run || !inst.version || inst.skew ? v.text : `$(debug-start) ${label}`
  const click = v.command ? [] : [failed ? 'Click to open the session log.' : older ? 'Click to restart it.' : `Cursor sync ${cursorSync ? 'on' : 'off'}. Click to open a view.`]
  return {
    text: textOf(p, label, holding, older, plain),
    tooltip: [v.tooltip, ...(holding ? [HOLD_LINE] : []), ...phaseLines(p), ...click].join('\n'),
    command: v.command ?? (failed ? 'pcbjs.openSessionLog' : older ? 'pcbjs.restartServer' : 'pcbjs.pickView'),
    ...(failed ? { tone: 'error' as const } : v.warning || older ? { tone: 'warning' as const } : {}),
  }
}
