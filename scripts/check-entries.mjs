#!/usr/bin/env node
// Every `@pcbjs/<pkg>/<path>` the repository imports must be an entry that package lists in `exports`: public entries anywhere,
// `./internal/<module>` entries only from a sibling package, a script, a test or the site, never from docs, skills, examples or templates.
// Fails too on a wildcard entry, an internal entry no sibling imports, a fab preset in src that `exports` lacks, and a back edge between
// the layers of packages/cli/src, CLI_LAYERS.
// Usage: node scripts/check-entries.mjs [--root <repo>]
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const SKIP = new Set(['node_modules', 'dist', '.git', '.pcbjs', '.changeset', 'cache', '.gallery', '.claude'])
const CODE = /\.(ts|tsx|mts|cts|mjs|js|cjs|vue)$/
/** a module specifier in code: after from, import, require or resolve */
const SPEC = /(?:from|import|require|resolve)\s*\(?\s*(['"`])(@pcbjs\/[a-z-]+(?:\/[^'"`$\s]*)?)\1/g
/** a path named in prose: in backticks, not inside a node_modules path */
const NAMED = /(?<![\w/.])(@pcbjs\/[a-z-]+\/[\w./-]*[\w-])/g

const posix = p => p.split(sep).join('/')

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const f = join(dir, e.name)
    if (e.isDirectory()) walk(f, out)
    else out.push(f)
  }
  return out
}

/** Each package's name, folder and the subpaths its exports list, `.` included. */
export function packageEntries(root) {
  const out = new Map()
  for (const dir of readdirSync(join(root, 'packages'))) {
    const file = join(root, 'packages', dir, 'package.json')
    if (!existsSync(file)) continue
    const p = JSON.parse(readFileSync(file, 'utf8'))
    if (!p.name?.startsWith('@pcbjs/')) continue
    out.set(p.name.slice('@pcbjs/'.length), { dir, keys: Object.keys(p.exports ?? {}) })
  }
  return out
}

/** Who may import internal entries: the package itself and its siblings, scripts, tests and the site; not what users read or copy. */
const consumer = rel => /^(docs|examples)\//.test(rel) || /^packages\/skills\//.test(rel) || /^packages\/cli\/templates\//.test(rel) || rel === 'README.md'

/** The specifiers a file names, each with its line. */
function specifiers(text, md) {
  const out = []
  const lineOf = i => text.slice(0, i).split('\n').length
  for (const m of text.matchAll(SPEC)) out.push({ spec: m[2], line: lineOf(m.index) })
  if (md) for (const m of text.matchAll(NAMED)) out.push({ spec: m[1], line: lineOf(m.index) })
  const seen = new Set()
  return out.filter(s => !s.spec.endsWith('...') && !seen.has(`${s.line} ${s.spec}`) && seen.add(`${s.line} ${s.spec}`))
}

/** Every problem of the repository at `root`, one line each. */
export function checkEntries(root) {
  const pkgs = packageEntries(root)
  const problems = []
  const used = new Map()
  for (const [name, p] of pkgs) for (const k of p.keys) if (k.includes('*')) problems.push(`packages/${p.dir}/package.json: the wildcard entry ${k}; list each entry by name`)
  const files = [
    ...walk(join(root, 'packages')).filter(f => CODE.test(f) || (f.endsWith('.md') && /[\\/]packages[\\/](skills|cli[\\/]templates)[\\/]/.test(f))),
    ...walk(join(root, 'scripts')).filter(f => CODE.test(f)),
    ...walk(join(root, 'site')).filter(f => CODE.test(f) || f.endsWith('.md')),
    ...walk(join(root, 'examples')).filter(f => CODE.test(f)),
    ...walk(join(root, 'docs')).filter(f => f.endsWith('.md')),
    ...[join(root, 'README.md')].filter(existsSync),
  ]
  for (const f of files) {
    const rel = posix(relative(root, f))
    if (/(^|\/)CHANGELOG\.md$/.test(rel)) continue
    const own = rel.startsWith('packages/') ? [...pkgs].find(([, p]) => rel.startsWith(`packages/${p.dir}/`))?.[0] : null
    for (const { spec, line } of specifiers(readFileSync(f, 'utf8'), f.endsWith('.md'))) {
      const [, name, ...rest] = spec.split('/')
      const p = pkgs.get(name)
      if (!p) continue
      const key = rest.length ? `./${rest.join('/')}` : '.'
      const at = `${rel}:${line}`
      if (!p.keys.includes(key)) {
        problems.push(`${at}: ${spec} is no entry of @pcbjs/${name}; its entries are ${p.keys.filter(k => !k.startsWith('./internal/')).join(', ')}`)
        continue
      }
      if (!key.startsWith('./internal/')) continue
      if (consumer(rel)) problems.push(`${at}: ${spec} is internal to the pcbjs packages; name a public entry`)
      if (own !== name) used.set(`${name} ${key}`, true)
    }
  }
  for (const [name, p] of pkgs)
    for (const k of p.keys)
      if (k.startsWith('./internal/') && !used.has(`${name} ${k}`)) problems.push(`packages/${p.dir}/package.json: ${k} has no importer outside @pcbjs/${name}; drop it`)
  const fab = pkgs.get('fab')
  if (fab) {
    const src = join(root, 'packages', fab.dir, 'src')
    for (const d of readdirSync(src, { withFileTypes: true }).filter(d => d.isDirectory()))
      for (const f of readdirSync(join(src, d.name)).filter(f => f.endsWith('.ts'))) {
        const key = `./${d.name}/${f.slice(0, -3)}`
        if (!fab.keys.includes(key)) problems.push(`packages/${fab.dir}/package.json: the preset ${key} is not listed in exports`)
      }
  }
  return [...problems, ...cliLayers(root)]
}

/** The folders of packages/cli/src, each importing only itself and those before it; a file at src/ itself is a command and imports any. */
export const CLI_LAYERS = { project: [], render: ['project'], server: ['project', 'render'], session: ['project', 'render', 'server'] }

const layerOf = rel => (rel.includes('/') && rel.split('/')[0] in CLI_LAYERS ? rel.split('/')[0] : 'command')

/** Every relative import in packages/cli/src that leaves its layer for one CLI_LAYERS does not list, a command included. */
export function cliLayers(root) {
  const src = join(root, 'packages', 'cli', 'src')
  const problems = []
  for (const f of walk(src).filter(f => f.endsWith('.ts'))) {
    const from = posix(relative(src, f))
    const layer = layerOf(from)
    if (layer === 'command') continue
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"?]+)['"]/g)) {
      const to = posix(relative(src, resolve(dirname(f), m[1])))
      const target = layerOf(to)
      if (target === layer || CLI_LAYERS[layer].includes(target)) continue
      const line = text.slice(0, m.index).split('\n').length
      problems.push(
        `packages/cli/src/${from}:${line}: ${layer}/ imports ${to}, a ${target === 'command' ? 'command' : `${target}/ module`}; ${layer}/ imports ${[layer, ...CLI_LAYERS[layer]].join('/, ')}/ only`,
      )
    }
  }
  return problems
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  const i = process.argv.indexOf('--root')
  const root = i > 0 ? resolve(process.argv[i + 1]) : join(import.meta.dirname, '..')
  const problems = checkEntries(root)
  for (const p of problems) console.log(p)
  console.log(problems.length ? `check-entries: ${problems.length} problems` : 'check-entries: every import names a listed entry')
  process.exit(problems.length ? 1 : 0)
}
