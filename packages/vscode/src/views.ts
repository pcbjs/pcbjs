// The preview tabs, one per view, without vscode: titles, URLs and the board the viewers show.

import * as path from 'node:path'
import type { IdeBoardsMsg, ViewName } from '@pcbjs/core/protocol'

export type Board = IdeBoardsMsg['boards'][number]

export const VIEWS: readonly ViewName[] = ['2d', '3d', 'sch', 'checks']
export const VIEW_NAMES: Record<ViewName, string> = { '2d': '2D', '3d': '3D', sch: 'Schematic', checks: 'DRC/ERC' }

export const isView = (v: unknown): v is ViewName => VIEWS.includes(v as ViewName)

/** `Blinky | 3D`, and `Blinky | 3D (2)` for a second pane of the same view. */
export const panelTitle = (board: string, view: ViewName, n = 1) => `${board} | ${VIEW_NAMES[view]}${n > 1 ? ` (${n})` : ''}`

/** The entry of the active file when it is one, else the board shown before when it is still there, else the first. */
export function shownBoard(info: IdeBoardsMsg | undefined, prev: string | undefined, file?: string, root?: string): Board | undefined {
  const boards = info?.boards ?? []
  const dir = info?.root ?? root
  const matches = file && dir ? boards.filter(b => b.entry && path.resolve(dir, b.entry) === file) : []
  const hit = matches.find(b => b.name === prev) ?? matches[0]
  return hit ?? boards.find(b => b.name === prev) ?? boards[0]
}

/** The viewer path of a board under a scope's page, which may itself be a board page. */
export function boardPath(page: string, name: string, target?: string | null): string {
  const scope = new URL(page, 'http://localhost/').pathname.replace(/\/board\/.*$/, '/').replace(/\/?$/, '/')
  return `${scope}board/${encodeURIComponent(name)}${target ? `/${encodeURIComponent(targetSlug(target))}` : ''}`
}

export const targetSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
