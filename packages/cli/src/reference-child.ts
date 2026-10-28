// node reference-child.js <entry> <out.json> <mesh dir>: writes { ok, board, hashes } or { ok: false, error } to <out.json>.
import { writeFileSync } from 'node:fs'
import { compileReferenced } from './references.js'

const [entry, out, meshDir] = process.argv.slice(2)
// the design's console output is the referencing compile's noise, not its result
console.log = () => {}
console.warn = () => {}
try {
  const r = await compileReferenced(entry, meshDir)
  writeFileSync(out, JSON.stringify({ ok: true, ...r }))
} catch (e: any) {
  writeFileSync(
    out,
    JSON.stringify({
      ok: false,
      error: String(e?.message ?? e)
        .replace(/\x1b\[[0-9;]*m/g, '')
        .split('\n')[0],
    }),
  )
}
process.exit(0)
