// The docs index, built after tsc from docs/*.md into the dist of @pcbjs/lsp, whose hover shows its excerpts, and of @pcbjs/cli, whose
// `pcbjs docs --grep` searches its lines: every topic's lines, its table rows and paragraphs with the code spans that open them.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')
const docs = join(root, 'docs')

const spans = s => [...s.matchAll(/`([^`]+)`/g)].map(m => m[1])
/** The code spans a block opens with: a row's first cell, a paragraph's or list item's first span when the text starts with it. */
const keysOf = (kind, text) => {
  if (kind === 'row') return spans(text.split('|')[1] ?? '')
  const m = /^(?:[-*]\s+|\d+\.\s+)?`([^`]+)`/.exec(text)
  return m ? [m[1]] : []
}

function topicIndex(text) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.startsWith('# '))
  // the title's two summary lines describe the topic, not one name
  const summary = lines
    .slice(start + 1)
    .filter(l => l.trim())
    .slice(0, 2)
  const blocks = []
  const defines = []
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) {
      fence = !fence
      return
    }
    if (fence || !l.trim() || summary.includes(l)) return
    if (l.startsWith('#')) {
      const keys = spans(l)
      const body = lines.slice(i + 1).find(x => x.trim() && !x.startsWith('#') && !/^\s*(```|\|)/.test(x))
      defines.push(...keys)
      if (keys.length && body) blocks.push({ line: i + 1, kind: 'head', keys, text: body.trim() })
      return
    }
    const row = /^\s*\|/.test(l)
    // a header row is followed by its separator; the separator holds nothing
    if (row && (/^\s*\|[\s:|-]+\|\s*$/.test(l) || /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? ''))) return
    const kind = row ? 'row' : 'para'
    blocks.push({ line: i + 1, kind, keys: keysOf(kind, l.trim()), text: l.trim() })
  })
  return { summary: summary[0] ?? '', lines, blocks: blocks.filter(b => b.keys.length), defines }
}

// in reading order, so a tie goes to the earlier topic
const order = await import(pathToFileURL(join(root, 'packages', 'cli', 'dist', 'docs.js')).href).then(
  m => m.TOPICS,
  () => [],
)
const names = readdirSync(docs)
  .filter(f => f.endsWith('.md'))
  .map(f => f.slice(0, -3))
const topics = {}
for (const t of [...order.filter(t => names.includes(t)), ...names.filter(t => !order.includes(t)).sort()]) topics[t] = topicIndex(readFileSync(join(docs, `${t}.md`), 'utf8'))
const index = JSON.stringify({ version: 1, topics })
for (const pkg of ['lsp', 'cli']) {
  const dist = join(root, 'packages', pkg, 'dist')
  if (!existsSync(dist)) mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'docs-index.json'), index)
}
