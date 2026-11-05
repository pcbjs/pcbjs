import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const key = b => JSON.stringify([b.entry, b.name, b.target ?? null])
const evidence = r => ({ result: r.result, exit: r.exit, diagnostics: r.diagnostics, typecheck: r.typecheck, tests: r.tests, versions: r.versions })
const semantic = f => JSON.stringify([f.severity, f.measured, f.required, f.provenance?.map(({ src, ...p }) => p), f.message])
const distance = (a, b) => (a.at && b.at ? Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) : a.at === b.at ? 0 : Infinity)

export function compareReports(before, after) {
  for (const r of [before, after]) if (r.schema !== 'pcbjs.check/1' || !Array.isArray(r.boards)) throw new Error('Expected pcbjs.check/1 report with boards')
  const old = new Map(before.boards.map(b => [key(b), b]))
  const boards = after.boards.map(b => {
    const prev = old.get(key(b))
    old.delete(key(b))
    const remaining = [...(prev?.findings ?? [])]
    const added = [],
      changed = []
    let retained = 0
    for (const f of b.findings) {
      const candidates = remaining.map((p, i) => ({ p, i })).filter(({ p }) => p.fingerprint === f.fingerprint)
      candidates.sort((a, c) => distance(a.p, f) - distance(c.p, f))
      const match = candidates[0]
      if (!match) added.push(f)
      else {
        remaining.splice(match.i, 1)
        retained++
        if (semantic(match.p) !== semantic(f)) changed.push({ before: match.p, after: f })
      }
    }
    return {
      entry: b.entry,
      board: b.name,
      target: b.target,
      status: [prev?.status ?? null, b.status],
      snapshots: [prev?.snapshot ?? null, b.snapshot],
      added,
      resolved: remaining,
      changed,
      retained,
    }
  })
  return { before: evidence(before), after: evidence(after), boards, removedBoards: [...old.values()] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: compare-reports.mjs before.json after.json')
  console.log(JSON.stringify(compareReports(...process.argv.slice(2).map(p => JSON.parse(readFileSync(p, 'utf8')))), null, 2))
}
