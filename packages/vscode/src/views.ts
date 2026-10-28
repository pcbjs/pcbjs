// The preview tabs, one per view, without vscode: titles, URLs and the board the viewers show.

import * as path from 'node:path'
import type { BoardsInfo, ViewKind } from './protocol'

export type { ViewKind }
export type Board = BoardsInfo['boards'][number]

export const VIEWS: readonly ViewKind[] = ['2d', '3d', 'sch']
export const VIEW_NAMES: Record<ViewKind, string> = { '2d': '2D', '3d': '3D', sch: 'Schematic' }

export const isView = (v: unknown): v is ViewKind => VIEWS.includes(v as ViewKind)

/** `Blinky | 3D`, and `Blinky | 3D (2)` for a second pane of the same view. */
export const panelTitle = (board: string, view: ViewKind, n = 1) => `${board} | ${VIEW_NAMES[view]}${n > 1 ? ` (${n})` : ''}`

/** The entry of the active file when it is one, else the board shown before when it is still there, else the first. */
export function shownBoard(info: BoardsInfo | undefined, prev: string | undefined, file?: string, root?: string): Board | undefined {
  const boards = info?.boards ?? []
  const dir = info?.root ?? root
  const hit = file && dir ? boards.find(b => b.entry && path.resolve(dir, b.entry) === file) : undefined
  return hit ?? boards.find(b => b.name === prev) ?? boards[0]
}

/** The viewer page of a board under a scope's page, which may itself be a board page. */
export function boardUrl(base: string, name: string): string {
  const u = new URL(base)
  u.pathname = u.pathname.replace(/\/board\/.*$/, '/')
  u.search = ''
  u.hash = ''
  return new URL(`board/${encodeURIComponent(name)}`, u).toString()
}
