// The feature catalogue, site/features/<category>/<id>.md: read, checked against docs/, the fixtures and the compiled boards, and
// turned into docs/support.md. Usage: node scripts/features.mjs [--write]; prints the matrix, or writes it with --write.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const CATEGORIES = ['design', 'routing', 'checks', 'output', 'editor', 'agents', 'tooling']
export const STATUSES = ['shipped', 'beta', 'planned']
const VIEWS = ['2d', '3d', 'sch']
const FIELDS = ['title', 'status', 'docs', 'fixture', 'view', 'flag', 'evidence', 'snippet', 'key']
// what the matrix calls each status
const SUPPORT = { shipped: 'supported', beta: 'partial', planned: 'missing' }
const label = c => c[0].toUpperCase() + c.slice(1)

/** One file: the frontmatter's `key: value` lines, then the summary paragraph. */
export function parseFeature(text, where) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!m) throw new Error(`${where}: no frontmatter`)
  const f = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(': ')
    const k = i < 0 ? line : line.slice(0, i)
    if (!FIELDS.includes(k)) throw new Error(`${where}: unknown field "${k}"`)
    f[k] = k === 'key' ? line.slice(i + 2) === 'true' : line.slice(i + 2).trim()
  }
  const summary = m[2].trim()
  return { ...f, ...(summary ? { summary } : {}) }
}

/** Every feature under `dir`, by category in CATEGORIES order, key cards first, then by title. */
export function readFeatures(dir = join(repo, 'site/features')) {
  const out = []
  for (const category of readdirSync(dir).sort()) {
    if (!CATEGORIES.includes(category)) throw new Error(`site/features/${category}: not a category, one of ${CATEGORIES.join(', ')}`)
    for (const file of readdirSync(join(dir, category)).filter(f => f.endsWith('.md'))) {
      const id = file.slice(0, -3)
      out.push({ id, category, ...parseFeature(readFileSync(join(dir, category, file), 'utf8'), `site/features/${category}/${file}`) })
    }
  }
  const rank = f => CATEGORIES.indexOf(f.category) * 10 + (f.key ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
}

/**
 * Throws on the first feature that names a docs topic docs/ lacks, a fixture file that does not exist, or a fixture no board was
 * compiled from. `boards` maps a fixture path from the repository root to its board's page id and views.
 */
export function checkFeatures(features, { boards, root = repo }) {
  for (const f of features) {
    const where = `site/features/${f.category}/${f.id}.md`
    if (!f.title) throw new Error(`${where}: no title`)
    if (!STATUSES.includes(f.status)) throw new Error(`${where}: status "${f.status}" is not one of ${STATUSES.join(', ')}`)
    if (f.status === 'planned') {
      const extra = Object.keys(f).filter(k => !['id', 'category', 'title', 'status'].includes(k))
      if (extra.length) throw new Error(`${where}: a planned entry carries its title only, not ${extra.join(', ')}`)
      continue
    }
    for (const k of ['docs', 'fixture', 'view', 'flag', 'evidence', 'summary']) if (!f[k]) throw new Error(`${where}: no ${k}`)
    if (!existsSync(join(root, 'docs', `${f.docs}.md`))) throw new Error(`${where}: docs topic "${f.docs}" is not in docs/`)
    if (!existsSync(join(root, f.fixture))) throw new Error(`${where}: fixture ${f.fixture} does not exist`)
    const board = boards.get(f.fixture)
    if (!board) throw new Error(`${where}: no board was compiled from ${f.fixture}`)
    if (!VIEWS.includes(f.view) || !board.views.includes(f.view)) throw new Error(`${where}: view "${f.view}" is not one of ${board.views.join(', ')}`)
    if (f.snippet && !existsSync(join(root, f.snippet))) throw new Error(`${where}: snippet ${f.snippet} does not exist`)
    if (f.status === 'shipped' && !existsSync(join(root, f.evidence))) throw new Error(`${where}: evidence ${f.evidence} is not a file`)
  }
  return features
}

/** docs/support.md: the topic, one table per category, each feature with its support and evidence. */
export function matrix(features) {
  const count = s => features.filter(f => f.status === s).length
  const cell = s => s.replace(/\|/g, '\\|')
  const lines = [
    '# Support matrix',
    '',
    'What pcbjs supports, supports in part and does not do yet, with the test or the gap behind each, generated from the feature catalogue of the site.',
    'Advanced. Each row is a file under `site/features/`, shown at https://pcbjs.dev/features; `node site/scripts/features.mjs --write` regenerates this file, and a test fails when it differs.',
    '',
    `${count('shipped')} supported, ${count('beta')} partial, ${count('planned')} missing. Supported names the test that covers it, partial what is still open, missing is on the roadmap.`,
  ]
  for (const c of CATEGORIES) {
    const rows = features.filter(f => f.category === c).sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status))
    if (!rows.length) continue
    lines.push('', `## ${label(c)}`, '', '| Feature | Support | Evidence |', '| --- | --- | --- |')
    for (const f of rows) {
      const evidence = f.status === 'planned' ? 'planned' : f.status === 'shipped' ? `\`${f.evidence}\`` : cell(f.evidence)
      lines.push(`| ${cell(f.title)} | ${SUPPORT[f.status]} | ${evidence} |`)
    }
  }
  return `${lines.join('\n')}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = matrix(readFeatures())
  if (process.argv.includes('--write')) writeFileSync(join(repo, 'docs/support.md'), text)
  else process.stdout.write(text)
}
