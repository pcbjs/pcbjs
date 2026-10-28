// Compiles every example project for the gallery: its numbers from the check report, its 2D view and schematic as SVG.
// Writes site/.gallery/{boards.json,*.svg}, untracked; docs:build and docs:dev run it first.
// Usage: node scripts/boards.mjs [project...]
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const site = resolve(here, '..')
const repo = resolve(site, '..')
const args = process.argv.slice(2)
const only = args.filter(a => !a.startsWith('-'))
const out = join(site, '.gallery')

/** The content hash of an example's top folder, generated files left out. */
function hash(dir) {
  const h = createHash('sha256')
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.pcbjs', 'shots', 'node_modules', 'REVIEW.md'].includes(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) h.update(relative(dir, p)).update(readFileSync(p))
    }
  }
  walk(dir)
  return h.digest('hex').slice(0, 16)
}

/** The content hash of what a project's gallery entry depends on besides its folder: these scripts and each package's src and top-level files, versions left out so a version bump keeps the entries. */
function packagesHash() {
  const h = createHash('sha256')
  for (const f of readdirSync(here).sort()) h.update(f).update(readFileSync(join(here, f)))
  const entries = d => readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  const add = p => h.update(relative(repo, p)).update(readFileSync(p))
  const walk = d => { for (const e of entries(d)) e.isDirectory() ? walk(join(d, e.name)) : e.isFile() && add(join(d, e.name)) }
  const unversioned = p => {
    const pkg = JSON.parse(readFileSync(p, 'utf8'))
    delete pkg.version
    for (const deps of [pkg.dependencies, pkg.peerDependencies, pkg.devDependencies])
      for (const name of Object.keys(deps ?? {})) if (name.startsWith('@pcbjs/')) deps[name] = ''
    return JSON.stringify(pkg)
  }
  for (const pkg of entries(join(repo, 'packages')).filter(e => e.isDirectory())) {
    const dir = join(repo, 'packages', pkg.name)
    for (const e of entries(dir)) {
      const p = join(dir, e.name)
      if (e.name === 'src') walk(p)
      else if (e.name === 'package.json') h.update(relative(repo, p)).update(unversioned(p))
      else if (e.isFile() && !/\.md$|^LICENSE$|\.tsbuildinfo$/.test(e.name)) add(p)
    }
  }
  return h.digest('hex').slice(0, 16)
}

/** Every directory under examples/ with a pcb.config.ts, one level of nesting allowed. */
function projects() {
  const root = join(repo, 'examples')
  const out = []
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue
    const dir = join(root, d.name)
    if (existsSync(join(dir, 'pcb.config.ts'))) out.push(dir)
    else for (const s of readdirSync(dir, { withFileTypes: true })) if (s.isDirectory() && existsSync(join(dir, s.name, 'pcb.config.ts'))) out.push(join(dir, s.name))
  }
  return out.filter(p => !only.length || only.includes(relative(root, p)))
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const compile = (cwd, dir) => spawnSync(process.execPath, [join(here, 'compile.mjs'), dir], { cwd, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 600_000 })

/** Width over height of an SVG's viewBox, so the site can size a board before its SVG loads. */
const aspect = file => { const [, , w, h] = /viewBox="([^"]+)"/.exec(readFileSync(file, 'utf8'))[1].split(' ').map(Number); return Math.round(w / h * 1000) / 1000 }

mkdirSync(out, { recursive: true })
const dataFile = join(out, 'boards.json')
const known = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : []
const boards = only.length ? known.filter(b => !only.includes(b.project)) : []
const tmp = mkdtempSync(join(tmpdir(), 'pcbjs-site-'))
const packages = packagesHash()

for (const dir of projects()) {
  const project = relative(join(repo, 'examples'), dir)
  const started = Date.now()
  const top = hash(join(repo, 'examples', project.split('/')[0]))
  // a project keeps its numbers and SVGs while neither its folder nor the packages changed
  const kept = known.filter(b => b.project === project && b.hash === top && b.packages === packages)
  if (kept.length && kept.every(b => existsSync(join(out, `${b.id}-2d.svg`)))) {
    boards.push(...kept)
    console.log(`boards: ${project}  unchanged`)
    continue
  }
  const work = join(tmp, slug(project))
  const r = compile(dir, work)
  const report = join(work, 'report.json')
  if (!existsSync(report)) { console.error(`boards: ${project}: no report\n${(r.stderr || r.stdout).trim().split('\n').slice(-3).join('\n')}`); continue }
  const seen = new Set()
  for (const b of JSON.parse(readFileSync(report, 'utf8')).boards) {
    if (seen.has(b.name)) continue
    seen.add(b.name)
    const id = slug(`${project}-${b.name}`)
    const aspects = {}
    for (const [view, file] of Object.entries(b.svg ?? {})) {
      copyFileSync(join(work, file), join(out, `${id}-${view}.svg`))
      aspects[view] = aspect(join(work, file))
    }
    boards.push({
      project, name: b.name, entry: b.entry, id, hash: top, packages, aspect: aspects,
      stats: b.stats, routing: b.routing, counts: b.counts, models: b.models, ms: b.ms,
    })
  }
  console.log(`boards: ${project}  ${seen.size} board${seen.size === 1 ? '' : 's'}  ${((Date.now() - started) / 1000).toFixed(1)} s`)
}

boards.sort((a, b) => a.project.localeCompare(b.project) || 0)
writeFileSync(dataFile, JSON.stringify(boards, null, 1) + '\n')
const ids = new Set(boards.map(b => b.id))
for (const f of readdirSync(out)) if (f.endsWith('.svg') && !ids.has(f.replace(/-(2d|sch)\.svg$/, ''))) rmSync(join(out, f))
rmSync(tmp, { recursive: true, force: true })
console.log(`boards: ${boards.length} boards in ${relative(repo, dataFile)}, SVGs beside it`)
