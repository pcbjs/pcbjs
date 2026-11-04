// Writes site/.gallery/home.json and the home page demo's SVGs, untracked: Blinky's layout highlighted with a span per source range,
// the ranges' item ids, uids, refs and chips, the tour, and the `show` region of each feature's snippet. docs:build and docs:dev run it first.
// The boards themselves reach the pages through `?pcb:board`, see config.mts. Usage: node scripts/boards.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFeatures } from './features.mjs'
import { highlight, palette, region } from './highlight.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const site = resolve(here, '..')
const repo = resolve(site, '..')
const out = join(site, '.gallery')
// the board whose source the home page maps to its drawing
const HERO = { project: 'demo', entry: 'blinky.pcb.tsx' }
// the home page's tour: the chips of the ranges it cycles through until the first hover
const TOUR = ['Q1', 'D2, R2', 'route VCC · H 9', 'route SIG · X(Q1[1])', 'pour GND B.Cu']

/** The content hash of what the demo depends on: the hero's project, these scripts and each package's src, so an unchanged tree compiles nothing. */
function hash() {
  const h = createHash('sha256')
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.pcbjs', 'node_modules', 'dist', 'shots'].includes(e.name)) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && !/\.tsbuildinfo$/.test(e.name)) h.update(relative(repo, p)).update(readFileSync(p))
    }
  }
  walk(join(repo, 'examples', HERO.project))
  walk(here)
  for (const pkg of readdirSync(join(repo, 'packages')).sort()) if (existsSync(join(repo, 'packages', pkg, 'src'))) walk(join(repo, 'packages', pkg, 'src'))
  return h.digest('hex').slice(0, 16)
}

const started = Date.now()
mkdirSync(out, { recursive: true })
const key = hash()
const stamp = join(out, 'hero.hash')
const hero = join(out, 'hero')
if (existsSync(stamp) && readFileSync(stamp, 'utf8') === key && existsSync(join(hero, 'map.json'))) console.log('boards: the home page demo unchanged')
else {
  rmSync(hero, { recursive: true, force: true })
  const r = spawnSync(process.execPath, [join(here, 'compile.mjs'), hero, HERO.entry], { cwd: join(repo, 'examples', HERO.project), encoding: 'utf8', timeout: 600_000 })
  if (r.status !== 0) {
    console.error(`boards: ${HERO.project}/${HERO.entry} did not compile\n${(r.stderr || r.stdout).trim().split('\n').slice(-5).join('\n')}`)
    process.exit(1)
  }
  writeFileSync(stamp, key)
}
writeFileSync(join(out, 'home.json'), JSON.stringify(home()))
console.log(`boards: site/.gallery/home.json in ${((Date.now() - started) / 1000).toFixed(1)} s`)

/** Width over height of an SVG's viewBox, so the page sizes the drawing before it loads. */
function aspect(file) {
  const [, , w, h] = /viewBox="([^"]+)"/.exec(readFileSync(file, 'utf8'))[1].split(' ').map(Number)
  return Math.round((w / h) * 1000) / 1000
}

/** The home page: the hero's region and map, the `show` region of each feature's snippet by its path, and the token colours. */
function home() {
  const pal = palette()
  const map = JSON.parse(readFileSync(join(hero, 'map.json'), 'utf8'))
  const { code, first } = region(readFileSync(join(repo, 'examples', HERO.project, HERO.entry), 'utf8'), 'example')
  const last = first + code.split('\n').length - 1
  const ranges = map.ranges.filter(r => r.start[0] >= first && r.end[0] <= last)
  const snippet = file => highlight(region(readFileSync(join(repo, file), 'utf8'), 'show', true).code, 'tsx', pal)
  return {
    hero: {
      entry: HERO.entry,
      name: map.name,
      file: `examples/${HERO.project}/${HERO.entry}`,
      aspect: { '2d': aspect(join(hero, '2d.svg')), ...(existsSync(join(hero, 'sch.svg')) ? { sch: aspect(join(hero, 'sch.svg')) } : {}) },
      html: highlight(code, 'tsx', pal, ranges, first),
      ranges: ranges.map(({ ids, uids, refs, chip }) => ({ ids, uids, refs, chip })),
      tour: TOUR.map(c => ranges.findIndex(r => r.chip === c)).filter(i => i >= 0),
    },
    snippets: Object.fromEntries(readFeatures().flatMap(f => (f.snippet ? [[f.snippet, snippet(f.snippet)]] : []))),
    css: pal.css(),
  }
}
