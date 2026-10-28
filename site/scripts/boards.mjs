// Compiles every example project and the home page's site/demos for the gallery: its numbers from the check report, its 2D view and schematic as SVG.
// Writes site/.gallery/{boards.json,home.json,*.svg}, untracked; docs:build and docs:dev run it first. home.json is the home page's highlighted code and Blinky's source map.
// Usage: node scripts/boards.mjs [project...]
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { highlight, palette, region } from './highlight.mjs'

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
  const walk = d => {
    for (const e of entries(d)) e.isDirectory() ? walk(join(d, e.name)) : e.isFile() && add(join(d, e.name))
  }
  const unversioned = p => {
    const pkg = JSON.parse(readFileSync(p, 'utf8'))
    delete pkg.version
    for (const deps of [pkg.dependencies, pkg.peerDependencies, pkg.devDependencies]) for (const name of Object.keys(deps ?? {})) if (name.startsWith('@pcbjs/')) deps[name] = ''
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

// the board whose source the home page maps to its drawing
const HERO = { project: 'demo', entry: 'blinky.pcb.tsx' }
// the home page's tour: the chips of the ranges it cycles through until the first hover
const TOUR = ['Q1', 'D2, R2', 'route VCC · H 9', 'route SIG · X(Q1[1])', 'pour GND B.Cu']

/** Every directory under examples/ with a pcb.config.ts, one level of nesting allowed, then site/demos: `{ dir, project, top, site }`. */
function projects() {
  const root = join(repo, 'examples')
  const out = []
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue
    const dir = join(root, d.name)
    if (existsSync(join(dir, 'pcb.config.ts'))) out.push(dir)
    else for (const s of readdirSync(dir, { withFileTypes: true })) if (s.isDirectory() && existsSync(join(dir, s.name, 'pcb.config.ts'))) out.push(join(dir, s.name))
  }
  const all = [
    ...out.map(dir => ({ dir, project: relative(root, dir), top: join(root, relative(root, dir).split('/')[0]), site: false })),
    { dir: join(site, 'demos'), project: 'site/demos', top: join(site, 'demos'), site: true },
  ]
  return all.filter(p => !only.length || only.includes(p.project))
}

const slug = s =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const compile = (cwd, dir, args) => spawnSync(process.execPath, [join(here, 'compile.mjs'), dir, ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 600_000 })

/** Width over height of an SVG's viewBox, so the site can size a board before its SVG loads. */
const aspect = file => {
  const [, , w, h] = /viewBox="([^"]+)"/.exec(readFileSync(file, 'utf8'))[1].split(' ').map(Number)
  return Math.round((w / h) * 1000) / 1000
}

mkdirSync(out, { recursive: true })
const dataFile = join(out, 'boards.json')
const known = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : []
const boards = only.length ? known.filter(b => !only.includes(b.project)) : []
const tmp = mkdtempSync(join(tmpdir(), 'pcbjs-site-'))
const packages = packagesHash()

/** A ring at each DRC finding, for the home page's DRC demo. */
const marked = (svg, drc) =>
  svg.replace('</svg>', drc.map(d => `<circle class="pcb-mark" cx="${d.at[0]}" cy="${d.at[1]}" r="0.7" fill="none" stroke="#e5484d" stroke-width="0.18"/>\n`).join('') + '</svg>')

for (const { dir, project, top: topDir, site: isSite } of projects()) {
  const started = Date.now()
  const top = hash(topDir)
  // a project keeps its numbers and SVGs while neither its folder nor the packages changed
  const kept = known.filter(b => b.project === project && b.hash === top && b.packages === packages)
  const whole = b => existsSync(join(out, `${b.id}-2d.svg`)) && (!b.map || existsSync(join(out, `${b.id}-map.json`)))
  if (kept.length && kept.every(whole)) {
    boards.push(...kept)
    console.log(`boards: ${project}  unchanged`)
    continue
  }
  const work = join(tmp, slug(project))
  const r = compile(dir, work, project === HERO.project ? ['--map', HERO.entry] : [])
  const report = join(work, 'report.json')
  if (!existsSync(report)) {
    console.error(`boards: ${project}: no report\n${(r.stderr || r.stdout).trim().split('\n').slice(-3).join('\n')}`)
    continue
  }
  const seen = new Set()
  for (const b of JSON.parse(readFileSync(report, 'utf8')).boards) {
    if (seen.has(b.name)) continue
    seen.add(b.name)
    const id = slug(`${project}-${b.name}`)
    const aspects = {}
    for (const [view, file] of Object.entries(b.svg ?? {})) {
      const svg = readFileSync(join(work, file), 'utf8')
      writeFileSync(join(out, `${id}-${view}.svg`), isSite && view === '2d' && b.drc.length ? marked(svg, b.drc) : svg)
      aspects[view] = aspect(join(work, file))
    }
    if (b.map) copyFileSync(join(work, b.map), join(out, `${id}-map.json`))
    boards.push({
      project,
      name: b.name,
      entry: b.entry,
      id,
      hash: top,
      packages,
      aspect: aspects,
      stats: b.stats,
      routing: b.routing,
      counts: b.counts,
      models: b.models,
      ms: b.ms,
      ...(isSite ? { site: true, drc: b.drc.slice(0, 1).map(({ rule, message, src }) => ({ rule, message, src })), findings: b.drc.length } : {}),
      ...(b.map ? { map: true } : {}),
    })
  }
  console.log(`boards: ${project}  ${seen.size} board${seen.size === 1 ? '' : 's'}  ${((Date.now() - started) / 1000).toFixed(1)} s`)
}

boards.sort((a, b) => a.project.localeCompare(b.project) || 0)
writeFileSync(dataFile, JSON.stringify(boards, null, 1) + '\n')
writeFileSync(join(out, 'home.json'), JSON.stringify(home()))
const ids = new Set(boards.map(b => b.id))
for (const f of readdirSync(out)) if (f.endsWith('.svg') && !ids.has(f.replace(/-(2d|sch)\.svg$/, ''))) rmSync(join(out, f))
rmSync(tmp, { recursive: true, force: true })

/** The home page: Blinky's region highlighted with a span per source range, the ranges' item ids, refs and chips, the tour, and each demo's `show` region. */
function home() {
  const pal = palette()
  const hero = boards.find(b => b.project === HERO.project && b.entry === HERO.entry)
  const map = JSON.parse(readFileSync(join(out, `${hero.id}-map.json`), 'utf8'))
  const { code, first } = region(readFileSync(join(repo, 'examples', HERO.project, HERO.entry), 'utf8'), 'example')
  const last = first + code.split('\n').length - 1
  const ranges = map.ranges.filter(r => r.start[0] >= first && r.end[0] <= last)
  const demo = (entry, file = entry) => {
    const b = boards.find(x => x.site && x.entry === entry)
    const { code } = region(readFileSync(join(site, 'demos', file), 'utf8'), 'show', true)
    return { id: b.id, file: `site/demos/${file}`, html: highlight(code, 'tsx', pal), ...(b.drc?.length ? { drc: b.drc[0], findings: b.findings } : {}) }
  }
  const page = {
    hero: {
      id: hero.id,
      file: `examples/${HERO.project}/${HERO.entry}`,
      html: highlight(code, 'tsx', pal, ranges, first),
      ranges: ranges.map(({ ids, refs, chip }) => ({ ids, refs, chip })),
      tour: TOUR.map(c => ranges.findIndex(r => r.chip === c)).filter(i => i >= 0),
    },
    route: demo('route.pcb.tsx'),
    pour: demo('pour.pcb.tsx'),
    drc: demo('drc.pcb.tsx'),
    schematic: demo('divider.pcb.tsx', 'divider.sch.tsx'),
    fab: { ...map.fab, html: highlight('npx pcbjs build   # the fab set and the viewer site\nnpm run dev       # the viewer, 2D and 3D, live on save', 'sh', pal) },
  }
  return { ...page, css: pal.css() }
}
console.log(`boards: ${boards.length} boards in ${relative(repo, dataFile)}, SVGs beside it`)
