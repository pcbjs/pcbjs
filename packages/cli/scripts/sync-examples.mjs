// Copies the example boards from examples/ into templates/examples, the source of truth staying examples/; `--check` lists drift and exits 1.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
export const OUT = resolve(here, '../templates/examples')

/** Each example: its one-line description, and the folder it comes from or the demo entry it is split out of. */
export const EXAMPLES = {
  blinky: { from: 'demo', entry: 'blinky.pcb.tsx', description: 'three LED channels on 30 x 20 mm, two layers, with the schematic, sourcing and layout in three files' },
  coin: { from: 'demo', entry: 'coin.pcb.tsx', description: 'the smallest board: two test pads on a 20 mm round board, all in one file' },
  quad: { from: 'demo', entry: 'quad.pcb.tsx', description: 'a divider on four layers, a signal on In1.Cu between a via pair and a ground plane' },
  multi: { from: 'demo', entry: 'multi.pcb.tsx', description: 'one design built for JLCPCB, OSH Park and a house target with variants' },
  'led-matrix': { from: 'led-matrix', description: 'an 8 x 8 WS2812B-2020 matrix from one circuit placed per pixel, chained in a serpentine' },
  'qfn-breakout': { from: 'qfn-breakout', description: 'a QFN64 at 0.5 mm pitch broken out to four headers by the autorouter' },
}

const SKIP = new Set(['REVIEW.md', 'shots', 'models', '.pcbjs', 'node_modules', 'dist'])
/** npm leaves .gitignore out of a published package; create renames it back. */
const RENAME = { '.gitignore': '_gitignore' }
const GITIGNORE = 'node_modules\n.pcbjs\n'

function walk(dir, base = dir) {
  return readdirSync(dir)
    .filter(f => !SKIP.has(f))
    .sort()
    .flatMap(f => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p)]
    })
}

/** The local modules an entry imports, itself included, by relative path. */
function closure(dir, entry) {
  const seen = new Set()
  const visit = rel => {
    if (seen.has(rel)) return
    seen.add(rel)
    const text = readFileSync(join(dir, rel), 'utf8')
    for (const [, spec] of text.matchAll(/(?:from|import)\s+'(\.{1,2}\/[^']+)'/g)) {
      const base = join(dirname(rel), spec)
      const hit = ['', '.ts', '.tsx'].map(ext => base + ext).find(p => existsSync(join(dir, p)) && statSync(join(dir, p)).isFile())
      if (hit) visit(hit)
    }
  }
  visit(entry)
  return [...seen]
}

/** Every file of one example: its path under templates/examples/<name> and its text. */
function exampleFiles(name, ex) {
  const dir = join(repo, 'examples', ex.from)
  const files = new Map()
  if (!ex.entry) {
    for (const rel of walk(dir)) files.set(join(dirname(rel), RENAME[rel.split('/').pop()] ?? rel.split('/').pop()), readFileSync(join(dir, rel), 'utf8'))
    if (!files.has('_gitignore')) files.set('_gitignore', GITIGNORE)
    return files
  }
  const renamed = text => text.replaceAll(ex.entry, 'pcb.tsx')
  for (const rel of closure(dir, ex.entry)) files.set(rel === ex.entry ? 'pcb.tsx' : rel, renamed(readFileSync(join(dir, rel), 'utf8')))
  files.set('pcb.config.ts', readFileSync(join(dir, 'pcb.config.ts'), 'utf8').replace(/entries: \[[^\]]*\]/, "entries: ['pcb.tsx']"))
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  files.set('package.json', JSON.stringify({ ...pkg, name }, null, 2) + '\n')
  files.set('tsconfig.json', readFileSync(join(dir, 'tsconfig.json'), 'utf8'))
  files.set('_gitignore', GITIGNORE)
  return files
}

/** What templates/examples should hold, by path relative to it. */
export function plan() {
  const out = new Map()
  const index = {}
  for (const [name, ex] of Object.entries(EXAMPLES)) {
    index[name] = ex.description
    for (const [rel, text] of exampleFiles(name, ex)) out.set(join(name, rel), text)
  }
  out.set('index.json', JSON.stringify(index, null, 2) + '\n')
  return out
}

/** Paths that differ between the plan and templates/examples; JSON compares by value, since the formatter may rewrap it. */
export function drift() {
  const want = plan()
  const have = existsSync(OUT) ? walk(OUT) : []
  const same = (rel, text) => {
    const disk = readFileSync(join(OUT, rel), 'utf8')
    return rel.endsWith('.json') ? JSON.stringify(JSON.parse(disk)) === JSON.stringify(JSON.parse(text)) : disk === text
  }
  return [...[...want].filter(([rel, text]) => !have.includes(rel) || !same(rel, text)).map(([rel]) => rel), ...have.filter(rel => !want.has(rel))].sort()
}

function sync() {
  rmSync(OUT, { recursive: true, force: true })
  for (const [rel, text] of plan()) {
    mkdirSync(dirname(join(OUT, rel)), { recursive: true })
    writeFileSync(join(OUT, rel), text)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const off = drift()
    for (const rel of off) console.log(`drift: templates/examples/${rel}`)
    process.exitCode = off.length ? 1 : 0
  } else {
    sync()
    console.log(`wrote ${relative(process.cwd(), OUT)}: ${Object.keys(EXAMPLES).join(', ')}`)
  }
}
