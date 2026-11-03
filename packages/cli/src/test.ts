// @pcbjs/cli/test: `board(name?, { target? })` in a board test, the board API over the snapshot `pcbjs test` wrote to PCBJS_TEST_DIR. Tests never compile.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boardApi, type Board } from '@pcbjs/compile/query'
import { variantSlug } from '@pcbjs/core/internal/variants'
import type { TestBoard } from './project/test-dir.js'

export type { Board }

const loaded = new Map<string, Board>()

function dir(): string {
  const d = process.env.PCBJS_TEST_DIR
  if (!d) throw new Error('board() reads the boards pcbjs test writes; run the file with pcbjs test, not node --test alone')
  return d
}

const files = () => readdirSync(dir()).filter(f => f.endsWith('.json') && !f.endsWith('.fab.json'))
const read = (f: string): TestBoard => JSON.parse(readFileSync(join(dir(), f), 'utf8'))

/** The board by name, the only one when the project has one; `target` picks a target by name or slug, the first by default. */
export function board(name?: string, o: { target?: string } = {}): Board {
  const key = `${name ?? ''}|${o.target ?? ''}`
  const hit = loaded.get(key)
  if (hit) return hit
  const all = files().map(read)
  const names = [...new Set(all.map(b => b.name))]
  const want = name ?? (names.length === 1 ? names[0] : null)
  if (!want) throw new Error(`board() needs a name, this project has ${names.join(', ')}`)
  const of = all.filter(b => b.name === want).sort((a, b) => (a.board.variant?.index ?? 0) - (b.board.variant?.index ?? 0))
  if (!of.length) throw new Error(`no board ${want}; boards: ${names.join(', ')}`)
  const t = o.target ? of.find(b => b.target === o.target || (b.target !== null && variantSlug(b.target) === o.target)) : of[0]
  if (!t) throw new Error(`no target ${o.target} of ${want}; targets: ${of.map(b => b.target).join(', ')}`)
  const api = boardApi({ board: t.board, findings: t.findings, snapshot: t.snapshot, root: t.root })
  loaded.set(key, api)
  return api
}
