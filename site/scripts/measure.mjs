// Report the built site’s total size, largest file and breakdown by asset category.
// Usage: node scripts/measure.mjs [dist] [--json].
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KINDS = [
  ['posters', f => /^assets\/.*\.svg$/.test(f)],
  ['compile runtime', f => f.startsWith('pcb/runtime/')],
  ['part meshes', f => f.startsWith('models/')],
  ['pcbjs packages for the designs', f => f.startsWith('pcb/lib/')],
  ['route memos and references', f => /^pcb\/[^/]+\/(routes|references)\//.test(f)],
  ['board modules', f => /^pcb\/.*\.module\.json$/.test(f)],
  ['project files', f => /^pcb\/[^/]+\/files\//.test(f)],
  ['design source maps', f => /^pcb\/.*\.map$/.test(f)],
  ['design modules', f => /^pcb\/.*\.js$/.test(f)],
  ['3D view and three.js', f => /^assets\/chunks\/(Board3D|Canvas3D)/.test(f)],
  ['docs pages', f => /^docs\//.test(f) || /^assets\/docs_/.test(f)],
  ['other pages, scripts and styles', () => true],
]

/** Every file under `dir` by its path from it, with its size. */
function walk(dir, at = dir, out = []) {
  for (const e of readdirSync(at, { withFileTypes: true })) {
    const f = join(at, e.name)
    if (e.isDirectory()) walk(dir, f, out)
    else out.push({ path: relative(dir, f).split('\\').join('/'), size: statSync(f).size })
  }
  return out
}

/** The sizes of a built site: total, the largest file and each kind's bytes and count. */
export function measure(dist) {
  const files = walk(dist)
  const kinds = Object.fromEntries(KINDS.map(([k]) => [k, { bytes: 0, files: 0 }]))
  for (const f of files) {
    const [k] = KINDS.find(([, test]) => test(f.path))
    kinds[k].bytes += f.size
    kinds[k].files++
  }
  const largest = files.reduce((a, b) => (b.size > a.size ? b : a), { path: '', size: 0 })
  return { total: files.reduce((a, f) => a + f.size, 0), files: files.length, largest, kinds }
}

const mb = n => `${(n / 1e6).toFixed(2)} MB`

/** The lines a build prints of its sizes. */
export function report(m) {
  return [
    `site: ${mb(m.total)} in ${m.files} files`,
    `site: largest ${m.largest.path} ${mb(m.largest.size)}`,
    ...Object.entries(m.kinds).map(([k, v]) => `  ${k.padEnd(32)} ${mb(v.bytes).padStart(9)}  ${v.files} files`),
  ]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const dist = resolve(args.find(a => !a.startsWith('-')) ?? join(dirname(fileURLToPath(import.meta.url)), '../.vitepress/dist'))
  const m = measure(dist)
  if (args.includes('--json')) console.log(JSON.stringify(m))
  else console.log(report(m).join('\n'))
}
