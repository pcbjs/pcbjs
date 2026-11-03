// node diff-child.js <root> <out.json> <config|-> [entry...]: compiles one tree's entries, writes { boards, errors } or { error } to <out.json>.
import { writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { boardFindings } from '@pcbjs/export/internal/findings'
import { resolveConfig } from './project/config.js'
import { compileHere } from './project/local.js'

const [root, out, config, ...entries] = process.argv.slice(2)
// the design's console output is noise here, the result is the file
console.log = () => {}
console.warn = () => {}
try {
  const cfg = await resolveConfig(entries, 'build', config === '-' ? undefined : config, root, () => {})
  const local = await compileHere(cfg)
  const boards = local.slots.flatMap(s =>
    (s.conflict ? [] : (s.compiled ?? [])).map(c => ({
      entry: relative(cfg.root, s.entry.file).split('\\').join('/'),
      target: c.board.variant?.name ?? null,
      board: c.board,
      findings: boardFindings(c.board, cfg.root),
    })),
  )
  writeFileSync(out, JSON.stringify({ boards, errors: local.errors }))
} catch (e: any) {
  writeFileSync(out, JSON.stringify({ error: String(e?.message ?? e).replace(/\x1b\[[0-9;]*m/g, '') }))
}
process.exit(0)
