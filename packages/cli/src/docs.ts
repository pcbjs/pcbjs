import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The topics in reading order; any other top-level .md file in the directory follows them. */
export const TOPICS = [
  'quickstart', 'board', 'schematic', 'circuits', 'schematic-graphic', 'sourcing', 'layout', 'pours', 'routing', 'autorouter', 'pairs', 'length', 'rules', 'findings', 'fab',
  'fab-set', 'cli', 'inspect', 'workspace', 'viewer', 'editor', 'highlight', '3d', 'models', 'references', 'skills', 'stdlib', 'kicad', 'import', 'stackup-and-rules', 'fonts', 'ide-bridge',
  'design', 'development',
]

/** The docs directory: the package's own, else the repository's when running from a checkout. Null when neither exists. */
export function docsDir(): string | null {
  const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  for (const dir of [join(pkg, 'docs'), join(pkg, '..', '..', 'docs')]) if (existsSync(join(dir, 'quickstart.md'))) return dir
  return null
}

/** Every topic in the directory, in reading order. */
export function topics(dir: string): string[] {
  const have = readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
  return [...TOPICS.filter(t => have.includes(t)), ...have.filter(t => !TOPICS.includes(t)).sort()]
}

/** The first summary line of a topic: the first non-empty line after the title. */
export function summaryOf(text: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.startsWith('# '))
  return lines.slice(start + 1).find(l => l.trim())?.trim() ?? ''
}

/** The topic list as lines. */
export function topicTable(dir: string): string[] {
  const list = topics(dir)
  const w = Math.max(...list.map(t => t.length))
  return [
    'pcbjs docs <topic> prints one topic; pcbjs docs --grep <word|regex> searches them all.',
    '',
    ...list.map(t => `  ${t.padEnd(w)}  ${summaryOf(readFileSync(join(dir, `${t}.md`), 'utf8'))}`),
  ]
}

/** The case-insensitive test of a --grep argument: a substring for plain words, else a regular expression when it parses. */
export function grepTest(word: string): (line: string) => boolean {
  const needle = word.toLowerCase()
  if (!/^[\w\s-]*$/.test(word)) {
    try { const re = new RegExp(word, 'i'); return l => re.test(l) } catch { /* a substring after all */ }
  }
  return l => l.toLowerCase().includes(needle)
}

/** Lines of the topics that match `word`, see grepTest, as `topic:line: text`. */
export function grepDocs(dir: string, word: string, only?: string[]): string[] {
  const test = grepTest(word)
  const out: string[] = []
  for (const t of only ?? topics(dir)) {
    readFileSync(join(dir, `${t}.md`), 'utf8').split('\n').forEach((l, i) => {
      if (test(l)) out.push(`${t}:${i + 1}: ${l}`)
    })
  }
  return out
}

/** A topic name as typed: `routing`, `routing.md` or `docs/routing.md`, any case. Null when there is none. */
export function topicOf(dir: string, name: string): string | null {
  const t = name.replace(/^.*[\\/]/, '').replace(/\.md$/i, '').toLowerCase()
  return topics(dir).find(x => x.toLowerCase() === t) ?? null
}

/** The command. Returns the exit code. */
export function docs(opts: { topic?: string; grep?: string }): number {
  const dir = docsDir()
  if (!dir) { console.error('pcbjs: the docs are not in this installation of pcbjs'); return 1 }
  let only: string[] | undefined
  if (opts.topic !== undefined) {
    const t = topicOf(dir, opts.topic)
    if (!t) { console.error(`pcbjs: no topic ${opts.topic}; topics: ${topics(dir).join(', ')}`); return 1 }
    only = [t]
  }
  if (opts.grep !== undefined) {
    const lines = grepDocs(dir, opts.grep, only)
    for (const l of lines) console.log(l)
    if (!lines.length) { console.error(`pcbjs: no line matches ${opts.grep}`); return 1 }
    return 0
  }
  if (only) { process.stdout.write(readFileSync(join(dir, `${only[0]}.md`), 'utf8')); return 0 }
  for (const l of topicTable(dir)) console.log(l)
  return 0
}
