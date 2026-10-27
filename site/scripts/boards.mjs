// Checks and shoots every example project for the gallery.
// Writes site/.shots/{boards.json,*.webp}, which the build prefers; --commit writes the tracked fallbacks in site/data and site/public/shots instead.
// Usage: node scripts/boards.mjs [--commit] [--if-chrome] [--no-shots] [-p <port>] [project...]
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(site, '..')
const bin = join(repo, 'packages/pcbjs/bin/pcbjs.js')
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const port = args.includes('-p') ? args[args.indexOf('-p') + 1] : undefined
const only = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '-p')
const commit = flag('--commit')
const dataOut = commit ? join(site, 'data') : join(site, '.shots')
const shotOut = commit ? join(site, 'public/shots') : join(site, '.shots')

const chrome = () => {
  const env = process.env.PCBJS_CHROME
  if (env) return existsSync(env)
  const mac = ['Google Chrome', 'Chromium', 'Microsoft Edge'].map(n => `/Applications/${n}.app`)
  if (mac.some(existsSync)) return true
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].some(n => spawnSync('which', [n]).status === 0)
}
const shoot = !flag('--no-shots') && chrome()
if (flag('--if-chrome') && !shoot) {
  console.log('boards: no Chrome, the gallery uses the committed shots and numbers')
  process.exit(0)
}

/** The content hash of an example's top folder, generated files left out: a project whose hash is unchanged keeps its shots. */
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

const pcbjs = (cwd, ...a) => spawnSync(process.execPath, [bin, ...a], { cwd, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 600_000 })
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// the viewer canvas of a 1200x750 shot, without the layer rail, the panel and the toolbar
const canvas = { left: 216, top: 80, width: 664, height: 670 }
const webp = (png, file, crop = true) =>
  (crop ? sharp(png).extract(canvas).resize({ width: 600 }) : sharp(png).resize({ width: 1200 })).webp({ quality: 72, effort: 6 }).toFile(file)

mkdirSync(dataOut, { recursive: true })
mkdirSync(shotOut, { recursive: true })
const dataFile = join(dataOut, 'boards.json')
const known = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, 'utf8')) : []
const boards = only.length ? known.filter(b => !only.includes(b.project)) : []
const tmp = mkdtempSync(join(tmpdir(), 'pcbjs-site-'))

for (const dir of projects()) {
  const project = relative(join(repo, 'examples'), dir)
  const started = Date.now()
  const top = hash(join(repo, 'examples', project.split('/')[0]))
  const kept = known.filter(b => b.project === project && b.hash === top)
  if (!commit && kept.length && kept.every(b => existsSync(join(shotOut, `${b.id}-3d.webp`)))) {
    boards.push(...kept)
    console.log(`boards: ${project}  unchanged`)
    continue
  }
  const report = join(tmp, `${slug(project)}.json`)
  pcbjs(dir, 'check', '--json', report)
  if (!existsSync(report)) { console.error(`boards: ${project}: check wrote no report`); continue }
  const seen = new Set()
  for (const b of JSON.parse(readFileSync(report, 'utf8')).boards) {
    if (seen.has(b.name)) continue
    seen.add(b.name)
    boards.push({
      project, name: b.name, entry: b.entry, id: slug(`${project}-${b.name}`), hash: top,
      stats: b.stats, routing: b.routing, counts: b.counts, models: b.models, ms: b.ms,
    })
  }
  if (shoot) {
    const out = join(tmp, slug(project))
    for (const view of ['2d', '3d', 'sch']) {
      const r = pcbjs(dir, 'shot', '--view', view, '--size', '1200x750', '--theme', 'dark', '-o', out, ...(port ? ['-p', port] : []))
      if (r.status !== 0) console.error(`boards: ${project}: shot ${view} failed\n${(r.stderr || r.stdout).trim().split('\n').slice(-3).join('\n')}`)
    }
    const pngs = existsSync(out) ? readdirSync(out).filter(f => f.endsWith('.png')) : []
    for (const b of boards.filter(b => b.project === project)) {
      for (const view of ['2d', '3d', 'sch']) {
        const png = pngs.find(f => f === `${b.name}-${view}-dark.png`) ?? pngs.find(f => f.startsWith(`${b.name}-`) && f.endsWith(`-${view}-dark.png`))
        if (!png) continue
        await webp(join(out, png), join(shotOut, `${b.id}-${view}.webp`))
        if (b.id === 'demo-blinky') await webp(join(out, png), join(shotOut, `viewer-${view}.webp`), false)
      }
    }
  }
  console.log(`boards: ${project}  ${seen.size} board${seen.size === 1 ? '' : 's'}  ${((Date.now() - started) / 1000).toFixed(1)} s`)
}

boards.sort((a, b) => a.project.localeCompare(b.project) || 0)
writeFileSync(dataFile, JSON.stringify(boards, null, 1) + '\n')
rmSync(tmp, { recursive: true, force: true })
console.log(`boards: ${boards.length} boards in ${relative(repo, dataFile)}${shoot ? `, shots in ${relative(repo, shotOut)}` : ''}`)
