import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The topics in reading order, the basic path first; any other top-level .md file in the directory follows them. */
export const TOPICS = [
  'basics',
  'quickstart',
  'board',
  'schematic',
  'layout',
  'routing',
  'check',
  'editor',
  'fab-set',
  'import',
  'advanced',
  'circuits',
  'footprints',
  'schematic-graphic',
  'sourcing',
  'stdlib',
  'placement',
  'grids',
  'stackup',
  'fonts',
  'pours',
  'route-options',
  'autorouter',
  'pairs',
  'length',
  'patches',
  'rules',
  'findings',
  'refs',
  'testing',
  'fab',
  'references',
  '3d',
  'models',
  'cli',
  'inspect',
  'viewer',
  'interaction',
  'editing',
  'layout-editing',
  'keys',
  'ui',
  'render',
  'diff',
  'vscode',
  'editor-actions',
  'highlight',
  'session',
  'workspace',
  'queries',
  'skills',
  'mcp',
  'lsp',
  'plugins',
  'browser',
  'library',
  'kicad',
  'stackup-and-rules',
  'ide-bridge',
  'design',
  'development',
  'support',
]

/** The docs directory: the package's own, else the repository's when running from a checkout. Null when neither exists. */
export function docsDir(): string | null {
  const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  for (const dir of [join(pkg, 'docs'), join(pkg, '..', '..', 'docs')]) if (existsSync(join(dir, 'quickstart.md'))) return dir
  return null
}

/** Every topic in the directory, in reading order. */
export function topics(dir: string): string[] {
  const have = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.slice(0, -3))
  return [...TOPICS.filter(t => have.includes(t)), ...have.filter(t => !TOPICS.includes(t)).sort()]
}

/** The first summary line of a topic: the first non-empty line after the title. */
export function summaryOf(text: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.startsWith('# '))
  return (
    lines
      .slice(start + 1)
      .find(l => l.trim())
      ?.trim() ?? ''
  )
}

/** A topic's level, the first word of its second summary line: `Basic.` or `Advanced.`, null when it has neither. */
export function levelOf(text: string): 'basic' | 'advanced' | null {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.startsWith('# '))
  const second = lines.slice(start + 1).filter(l => l.trim())[1] ?? ''
  return /^Basic\./.test(second) ? 'basic' : /^Advanced\./.test(second) ? 'advanced' : null
}

/** The topic list as lines, under Basics and Advanced; a topic of no level goes under Advanced. */
export function topicTable(dir: string): string[] {
  const list = topics(dir).map(t => {
    const text = readFileSync(join(dir, `${t}.md`), 'utf8')
    return { t, summary: summaryOf(text), basic: levelOf(text) === 'basic' }
  })
  const w = Math.max(...list.map(x => x.t.length))
  const rows = (basic: boolean) => list.filter(x => x.basic === basic).map(x => `  ${x.t.padEnd(w)}  ${x.summary}`)
  return [
    'pcbjs docs <topic> prints one topic; pcbjs docs --grep <word|regex> searches them all. Start with basics.',
    '',
    'Basics, a first board in order:',
    ...rows(true),
    '',
    'Advanced:',
    ...rows(false),
  ]
}

/** The case-insensitive test of a --grep argument: a substring for plain words, else a regular expression when it parses. */
export function grepTest(word: string): (line: string) => boolean {
  const needle = word.toLowerCase()
  if (!/^[\w\s-]*$/.test(word)) {
    try {
      const re = new RegExp(word, 'i')
      return l => re.test(l)
    } catch {
      /* a substring after all */
    }
  }
  return l => l.toLowerCase().includes(needle)
}

let index: { topics: Record<string, { lines: string[] }> } | null | undefined
/** Each topic's lines from the docs index the build wrote, which the language server's hover reads too; null without one. */
function indexed(topic: string): string[] | null {
  if (index === undefined)
    try {
      index = JSON.parse(readFileSync(new URL('./docs-index.json', import.meta.url), 'utf8'))
    } catch {
      index = null
    }
  return index?.topics[topic]?.lines ?? null
}

/** Lines of the topics that match `word`, see grepTest, as `topic:line: text`. */
export function grepDocs(dir: string, word: string, only?: string[]): string[] {
  const test = grepTest(word)
  const out: string[] = []
  for (const t of only ?? topics(dir)) {
    ;(indexed(t) ?? readFileSync(join(dir, `${t}.md`), 'utf8').split('\n')).forEach((l, i) => {
      if (test(l)) out.push(`${t}:${i + 1}: ${l}`)
    })
  }
  return out
}

/** A topic name as typed: `routing`, `routing.md` or `docs/routing.md`, any case. Null when there is none. */
export function topicOf(dir: string, name: string): string | null {
  const t = name
    .replace(/^.*[\\/]/, '')
    .replace(/\.md$/i, '')
    .toLowerCase()
  return topics(dir).find(x => x.toLowerCase() === t) ?? null
}

/** The command. Returns the exit code. */
export function docs(opts: { topic?: string; grep?: string }): number {
  const dir = docsDir()
  if (!dir) {
    console.error('pcbjs: the docs are not in this installation of pcbjs')
    return 1
  }
  let only: string[] | undefined
  if (opts.topic !== undefined) {
    const t = topicOf(dir, opts.topic)
    if (!t) {
      console.error(`pcbjs: no topic ${opts.topic}; topics: ${topics(dir).join(', ')}`)
      return 1
    }
    only = [t]
  }
  if (opts.grep !== undefined) {
    const lines = grepDocs(dir, opts.grep, only)
    for (const l of lines) console.log(l)
    if (!lines.length) {
      console.error(`pcbjs: no line matches ${opts.grep}`)
      return 1
    }
    return 0
  }
  if (only) {
    process.stdout.write(readFileSync(join(dir, `${only[0]}.md`), 'utf8'))
    return 0
  }
  for (const l of topicTable(dir)) console.log(l)
  return 0
}
