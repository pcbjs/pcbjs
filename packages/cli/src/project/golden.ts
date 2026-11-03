// Golden fab output for `pcbjs test`: Gerbers compared by the area read back per layer, drills by their holes, the IPC-D-356 netlist as
// net and pad pairs, so dates, aperture numbers and file order never fail a golden.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FAB_TOLERANCE, readGerber } from '@pcbjs/export/internal/fab-check'
import { area, clipRings, polysToRings, strokeOpen } from '@pcbjs/compile/internal/geom'
import type { Ring } from '@pcbjs/core/model'

/** The files of a fab set a golden keeps: the Gerbers, the drills and the netlist. */
export const goldenFile = (name: string): boolean => /\.(gtl|gbl|gts|gbs|gtp|gbp|gto|gbo|gm1|g\d+|drl|ipc)$/i.test(name)

/** Replace the golden folder with the set's files. */
export function writeGolden(dir: string, files: Record<string, string>): string[] {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const names = Object.keys(files).filter(goldenFile).sort()
  for (const n of names) writeFileSync(join(dir, n), files[n])
  return names
}

const darkRings = (text: string): Ring[] => {
  const g = readGerber(text)
  // a drawn path such as the outline counts as a thin band
  return [...polysToRings(g.polys), ...polysToRings(g.paths.flatMap(p => strokeOpen(p, 0.02)))]
}

/** mm² where the two Gerbers differ. */
export function gerberDiff(a: string, b: string): number {
  return area(clipRings('xor', darkRings(a), darkRings(b)))
}

const holes = (text: string): string[] => {
  const tools = new Map<string, string>()
  const out: string[] = []
  let tool = ''
  for (const l of text.split('\n')) {
    const def = /^T(\d+)C([\d.]+)/.exec(l)
    if (def) tools.set(def[1], def[2])
    else if (/^T\d+$/.test(l)) tool = tools.get(l.slice(1)) ?? l
    else if (/^X/.test(l)) out.push(`${tool} ${l}`)
  }
  return out.sort()
}

const pairs = (ipc: string): string[] =>
  ipc
    .split('\n')
    .filter(l => /^(317|327|367)/.test(l))
    .map(l => `${l.slice(3, 17).trim()} ${l.slice(20, 26).trim()}-${l.slice(27, 31).trim()}`)
    .sort()

const listDiff = (a: string[], b: string[]): string[] => {
  const left = new Map<string, number>()
  for (const x of a) left.set(x, (left.get(x) ?? 0) + 1)
  const out: string[] = []
  for (const x of b) {
    const n = left.get(x) ?? 0
    if (n) left.set(x, n - 1)
    else out.push(`+ ${x}`)
  }
  for (const [x, n] of left) for (let i = 0; i < n; i++) out.push(`- ${x}`)
  return out
}

/** Every difference of the current set from the golden folder, one line each; none when they agree. */
export function compareGolden(dir: string, files: Record<string, string>): string[] {
  if (!existsSync(dir)) return [`no golden at ${dir}; pcbjs test --update writes it`]
  const want = readdirSync(dir).filter(goldenFile).sort()
  const have = Object.keys(files).filter(goldenFile).sort()
  const out: string[] = []
  for (const n of want.filter(n => !have.includes(n))) out.push(`${n}: in the golden, not in the fab set`)
  for (const n of have.filter(n => !want.includes(n))) out.push(`${n}: in the fab set, not in the golden`)
  for (const n of want.filter(n => have.includes(n))) {
    const g = readFileSync(join(dir, n), 'utf8'),
      c = files[n]
    if (/\.drl$/i.test(n)) {
      const d = listDiff(holes(g), holes(c))
      if (d.length) out.push(`${n}: ${d.length} hole${d.length === 1 ? '' : 's'} differ, ${d.slice(0, 3).join('; ')}`)
    } else if (/\.ipc$/i.test(n)) {
      const d = listDiff(pairs(g), pairs(c))
      if (d.length) out.push(`${n}: ${d.length} net and pad pair${d.length === 1 ? '' : 's'} differ, ${d.slice(0, 3).join('; ')}`)
    } else {
      const mm2 = gerberDiff(g, c)
      if (mm2 > FAB_TOLERANCE) out.push(`${n}: ${mm2.toFixed(3)} mm² of copper or ink differ from the golden`)
    }
  }
  return out
}
