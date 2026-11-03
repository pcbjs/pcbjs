// `.pcbjs/test/<snapshot>/`: each board of one snapshot as `board()` of @pcbjs/cli/test reads it, and its fab files for the goldens.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { variantSlug } from '@pcbjs/core/internal/variants'
import type { Board } from '@pcbjs/core/model'
import type { Finding } from '@pcbjs/export/internal/findings'
import { goldenFile } from './golden.js'
import type { FabSet } from '@pcbjs/export/internal/fab'
import type { BoardOut } from './project.js'

/** What one board file holds. */
export interface TestBoard {
  name: string
  target: string | null
  snapshot: string
  root: string
  board: Board
  findings: Finding[]
}

/** `<board>` or `<board>-<target slug>`, the name of its file and of its golden folder. */
export const testKey = (c: Pick<BoardOut, 'board'>): string => (c.board.variant ? `${c.board.name}-${variantSlug(c.board.variant.name)}` : c.board.name)

export const testRoot = (root: string): string => join(root, '.pcbjs', 'test')

/** Write the snapshot's boards and their fab sets, dropping the folders of older snapshots; returns the folder. */
export async function writeTestDir(
  root: string,
  snapshot: string,
  boards: { compiled: BoardOut; findings: Finding[] }[],
  fabOf: (c: BoardOut) => FabSet | Promise<FabSet>,
): Promise<string> {
  const base = testRoot(root)
  const dir = join(base, snapshot)
  mkdirSync(dir, { recursive: true })
  try {
    for (const d of readdirSync(base)) if (d !== snapshot) rmSync(join(base, d), { recursive: true, force: true })
  } catch {}
  for (const { compiled: c, findings } of boards) {
    const key = testKey(c)
    const data: TestBoard = { name: c.board.name, target: c.board.variant?.name ?? null, snapshot, root, board: c.board, findings }
    writeFileSync(join(dir, `${key}.json`), JSON.stringify(data))
    const fab = Object.fromEntries(Object.entries((await fabOf(c)).files).filter(([n]) => goldenFile(n)))
    writeFileSync(join(dir, `${key}.fab.json`), JSON.stringify(fab))
  }
  return dir
}
