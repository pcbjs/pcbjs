// The topic files of docs/, read where they are: each becomes /docs/<topic>, its two-line summary the page description.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { development, developmentTopics, developmentLinks } from '../scripts/development.mjs'

export const repo = fileURLToPath(new URL('../..', import.meta.url))
export const docsDir = join(repo, 'docs')

export type Level = 'Basics' | 'Advanced'

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
  return { topic, title, description: summary.join(' ').replace(/`/g, ''), body: developmentLinks(linkTopics(text, new Set(topicNames())), new Set(topicNames())) }
}

/** `see board.md` in prose becomes a link to that page; code spans and fences are left alone. */
function linkTopics(text: string, topics: Set<string>): string {
  return text
    .split(/(^```[\s\S]*?^```)/m)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .split(/(`[^`\n]*`|\[[^\]]*\]\([^)]+\))/)
            .map((s, j) => (j % 2 ? s : s.replace(/(?<![\w/.[-])([a-z0-9-]+)\.md\b(?!\])/g, (m, t) => (topics.has(t) ? `[${m}](./${t})` : m))))
            .join(''),
    )
    .join('')
}

/** A topic's level, the `Basic.` or `Advanced.` that starts the second line of its summary. */
export function levelOf(topic: string): Level {
  const text = readFileSync(join(docsDir, `${topic}.md`), 'utf8')
  const summary = text.split('\n## ')[0]
  return /^Basic\.\s/m.test(summary) ? 'Basics' : 'Advanced'
}

/** The Basics in the order of the README's Basics table. */
function basicsOrder(): string[] {
  const text = readFileSync(join(repo, 'README.md'), 'utf8')
  const table = text.split('\n### Basics\n')[1]?.split('\n### ')[0] ?? ''
  return [...table.matchAll(/^\| `([\w-]+)` \|/gm)].map(m => m[1])
}

/** The sections of advanced.md with their topics in order, advanced.md itself first. */
function advancedSections(): [string, string[]][] {
  const text = readFileSync(join(docsDir, 'advanced.md'), 'utf8')
  return text
    .split('\n## ')
    .slice(1)
    .map(s => [s.split('\n')[0].trim(), [...s.matchAll(/^- ([\w-]+)\.md:/gm)].map(m => m[1])] as [string, string[]])
}

const item = (t: string) => ({ text: readTopic(t).title, link: `/docs/${t}` })

/** Basics, then Advanced by the sections of advanced.md; each topic by its marker, one in no list at the end of its level. */
export function sidebar() {
  const names = topicNames().filter(t => t !== 'quickstart' && !developmentTopics.has(t))
  const basics = names.filter(t => levelOf(t) === 'Basics')
  const ordered = [...new Set([...basicsOrder(), ...basics])].filter(t => basics.includes(t))
  const advanced = names.filter(t => levelOf(t) === 'Advanced' && t !== 'advanced')
  const sections = advancedSections().map(([text, ts]) => ({ text, collapsed: true, items: ts.filter(t => advanced.includes(t)).map(item) }))
  const placed = new Set(advancedSections().flatMap(([, ts]) => ts))
  const rest = advanced.filter(t => !placed.has(t))
  if (rest.length) sections.push({ text: 'More', collapsed: true, items: rest.map(item) })
  return [
    { text: 'Basics', collapsed: false, items: ordered.map(item) },
    { text: 'Advanced', collapsed: false, items: [...(names.includes('advanced') ? [item('advanced')] : []), ...sections.filter(s => s.items.length)] },
  ]
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
  if (topic && developmentTopics.has(topic)) return ''
  if (topic && topicNames().includes(topic)) return readTopic(topic).body
  const spec = /^development\/([\w-]+)\/([\w-]+)\.md$/.exec(rel)
  if (spec && developmentTopics.get(spec[2])?.section === spec[1]) return readTopic(spec[2]).body.replace(/^# .+$/m, `# ${developmentTopics.get(spec[2]).title}`)
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

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A topic made safe for Vue: inline code holding `{{` or `}}` becomes `<code v-pre>`, fenced code stays as VitePress marks it; the rest compiles to static HTML, which the lean page chunks leave out. */
export function vueSafe(md: string): string {
  return md
    .split(/(^(?:```|~~~)[\s\S]*?^(?:```|~~~)$)/m)
    .map((part, i) => (i % 2 ? part : part.replace(/`([^`\n]+)`/g, (code, text: string) => (/\{\{|\}\}/.test(text) ? `<code v-pre>${escapeHtml(text)}</code>` : code))))
    .join('')
}

/** Full contract pages share the CLI's Markdown source, with one canonical website route. */
export function developmentPaths(section: string) {
  const group = development.find(s => s.id === section)
  if (!group) throw new Error(`Unknown specification section: ${section}`)
  return group.groups.flatMap(g =>
    g.topics.map(([topic, title]) => {
      const source = readTopic(topic)
      const oldAnchor = slugify(source.title)
      const anchor = oldAnchor === slugify(title) ? '' : `<span id="${oldAnchor}"></span>\n\n`
      const body = anchor + source.body.replace(/^# .+$/m, `# ${title}`)
      return { params: { topic, title, description: source.description }, content: vueSafe(body) }
    }),
  )
}
