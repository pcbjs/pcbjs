// The topic files of docs/, read where they are: each becomes /docs/<topic>, its two-line summary the page description.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repo = fileURLToPath(new URL('../..', import.meta.url))
export const docsDir = join(repo, 'docs')

/** Sidebar groups in the order of the README topic table; a topic left out lands in Background. */
export const groups: [string, string[]][] = [
  ['Start', ['quickstart']],
  ['Schematic', ['board', 'schematic', 'circuits', 'schematic-graphic', 'sourcing']],
  ['Layout', ['layout', 'pours']],
  ['Routing', ['routing', 'autorouter', 'pairs', 'length']],
  ['Checks', ['rules', 'findings']],
  ['Output', ['fab', 'fab-set', 'cli', 'inspect']],
  ['Viewer and editor', ['viewer', 'editor', 'highlight', '3d', 'models', 'references']],
  ['Agents', ['skills']],
  ['Library', ['stdlib']],
  ['From KiCad', ['kicad', 'import']],
  ['Background', ['workspace', 'stackup-and-rules', 'fonts', 'ide-bridge', 'design', 'development']],
]

export interface Topic {
  topic: string
  title: string
  description: string
  body: string
}

export function topicNames(): string[] {
  return readdirSync(docsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.slice(0, -3))
    .sort()
}

/** Title from the H1, description from the paragraph under it. */
export function readTopic(topic: string): Topic {
  const text = readFileSync(join(docsDir, `${topic}.md`), 'utf8')
  const lines = text.split('\n')
  const h1 = lines.findIndex(l => l.startsWith('# '))
  const title = h1 < 0 ? topic : lines[h1].slice(2).trim()
  const summary: string[] = []
  for (const l of lines.slice(h1 + 1)) {
    if (l.trim() === '') {
      if (summary.length) break
      continue
    }
    if (l.startsWith('#') || l.startsWith('```')) break
    summary.push(l.trim())
  }
  return { topic, title, description: summary.join(' ').replace(/`/g, ''), body: linkTopics(text, new Set(topicNames())) }
}

/** `see board.md` in prose becomes a link to that page; code spans and fences are left alone. */
function linkTopics(text: string, topics: Set<string>): string {
  return text
    .split(/(^```[\s\S]*?^```)/m)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .split(/(`[^`\n]*`)/)
            .map((s, j) => (j % 2 ? s : s.replace(/(?<![\w/.[-])([a-z0-9-]+)\.md\b(?!\])/g, (m, t) => (topics.has(t) ? `[${m}](./${t})` : m))))
            .join(''),
    )
    .join('')
}

export function sidebar() {
  const names = topicNames()
  const listed = new Set(groups.flatMap(([, t]) => t))
  const extra = names.filter(t => !listed.has(t))
  return groups
    .map(([text, topics], i) => ({
      text,
      collapsed: false,
      items: topics
        .concat(i === groups.length - 1 ? extra : [])
        .filter(t => names.includes(t))
        .map(t => ({ text: readTopic(t).title, link: `/docs/${t}` })),
    }))
    .filter(g => g.items.length)
}

/** The README's `## For agents` section, its heading kept. */
export function readmeSection(heading: string): string {
  const text = readFileSync(join(repo, 'README.md'), 'utf8')
  const start = text.indexOf(`\n## ${heading}\n`)
  if (start < 0) return ''
  const end = text.indexOf('\n## ', start + 4)
  return text.slice(start + 1, end < 0 ? undefined : end).trim()
}

/** The release notes: the root CHANGELOG.md, else the meta package's, which carries the train. */
export function changelog(): string | null {
  for (const f of ['CHANGELOG.md', 'packages/pcbjs/CHANGELOG.md']) {
    const p = join(repo, f)
    if (existsSync(p))
      return readFileSync(p, 'utf8')
        .replace(/^# .*\n/, '')
        .trim()
  }
  return null
}

export function agentsPage(): string {
  return `# For agents

pcbjs is built to be driven by a coding agent as much as by a person: one command checks a board, every finding names the source line to change, and every topic file prints in the terminal. This page is the For agents section of the README, which an agent reads first. The package \`@pcbjs/skills\` carries the same guidance as agent skills.

${readmeSection('For agents')
  .replace(/^## For agents\n+/, '')
  .replace(/^### /gm, '## ')}
`
}

export function changelogPage(): string {
  return `# Changelog

Every \`@pcbjs/*\` package is released on one train: a package that changed gets the train's version, the others keep theirs. Each package also keeps its own CHANGELOG.md.

${changelog() ?? 'No release yet. The first train is 0.1.0-beta.1; its notes appear here once Changesets writes them.'}
`
}

/** The markdown of a page that has no file of its own, by its path under site/. */
export function dynamicPage(rel: string): string | undefined {
  const topic = /^docs\/([\w-]+)\.md$/.exec(rel)?.[1]
  if (topic && topicNames().includes(topic)) return readTopic(topic).body
  if (rel === 'agents.md') return agentsPage()
  if (rel === 'changelog.md') return changelogPage()
}

const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()
const plain = (s: string) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Search sections of a dynamic page, which local search cannot read from disk: one per heading, as VitePress splits a page. */
export function searchSections(markdown: string) {
  const out: { anchor: string; titles: string[]; text: string }[] = []
  const stack: string[] = []
  const seen = new Map<string, number>()
  let fence = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fence = !fence
    const h = fence ? null : /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const title = plain(h[2])
      stack.length = h[1].length - 1
      stack.push(title)
      const slug = slugify(title)
      const n = seen.get(slug) ?? 0
      seen.set(slug, n + 1)
      out.push({ anchor: n ? `${slug}-${n}` : slug, titles: stack.filter(Boolean), text: '' })
    } else if (out.length) out[out.length - 1].text += plain(line) + ' '
  }
  return out
}
