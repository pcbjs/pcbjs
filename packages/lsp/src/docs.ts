// Docs in hover: the table row or paragraph of the topic that defines the prop, element or call under the cursor, from the index
// scripts/docs-index.mjs writes into dist at build time, read once on load so a hover reads no file.
import { readFileSync } from 'node:fs'
import ts from 'typescript'

export interface DocBlock {
  line: number
  /** a heading's code spans with the paragraph under it, a table row, a paragraph or list item */
  kind: 'head' | 'row' | 'para'
  keys: string[]
  text: string
}
export interface DocTopic {
  summary: string
  lines: string[]
  blocks: DocBlock[]
  /** the code spans of its headings: what the topic defines */
  defines: string[]
}
export interface DocsIndex {
  version: number
  topics: Record<string, DocTopic>
}

/** What the cursor names: a prop of an element, an element, a function call or a builder method. */
export type DocToken = { kind: 'prop'; name: string; owner: string } | { kind: 'element'; name: string } | { kind: 'call'; name: string } | { kind: 'method'; name: string }

export interface Excerpt {
  topic: string
  line: number
  text: string
  url: string
}

export const DOCS_URL = 'https://pcbjs.dev/docs/'

let loaded: DocsIndex | null | undefined
/** The index of this build, null when the build wrote none. */
export function docsIndex(): DocsIndex | null {
  if (loaded !== undefined) return loaded
  try {
    loaded = JSON.parse(readFileSync(new URL('./docs-index.json', import.meta.url), 'utf8')) as DocsIndex
  } catch {
    loaded = null
  }
  return loaded
}

const inside = (n: ts.Node, sf: ts.SourceFile, at: number) => n.getStart(sf) <= at && at < n.getEnd()
const tagOf = (n: ts.JsxAttributes, sf: ts.SourceFile) => (n.parent as ts.JsxOpeningLikeElement).tagName.getText(sf)

/** The innermost prop name, tag name, called function or method name at a UTF-16 offset. */
export function docTokenAt(sf: ts.SourceFile, offset: number): DocToken | null {
  let found: DocToken | null = null
  const visit = (n: ts.Node): void => {
    if (offset < n.pos || offset >= n.end || !inside(n, sf, offset)) return
    if (ts.isJsxAttribute(n) && inside(n.name, sf, offset)) found = { kind: 'prop', name: n.name.getText(sf), owner: tagOf(n.parent, sf) }
    else if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxClosingElement(n)) && inside(n.tagName, sf, offset))
      found = { kind: 'element', name: n.tagName.getText(sf) }
    else if (ts.isCallExpression(n)) {
      const e = n.expression
      if (ts.isIdentifier(e) && inside(e, sf, offset)) found = { kind: 'call', name: e.text }
      else if (ts.isPropertyAccessExpression(e) && inside(e.name, sf, offset)) found = { kind: 'method', name: e.name.text }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

/** Whether a block's opening code span names the token. */
function names(key: string, t: DocToken): boolean {
  if (t.kind === 'prop') return key === t.name || key.startsWith(`${t.name}=`)
  if (t.kind === 'call') return key.startsWith(`${t.name}(`)
  if (t.kind === 'method') return key.startsWith(`.${t.name}(`)
  return key === `<${t.name}>` || key.startsWith(`<${t.name} `) || key.startsWith(`<${t.name}/`)
}

const WEIGHT = { head: 3, row: 2, para: 1 }

/** The block that defines the token: a heading over a table row over a paragraph, in the topic with a heading for the element or whose
 * summary opens with the name, the earlier topic in reading order on a tie. */
export function excerptFor(index: DocsIndex, t: DocToken): Excerpt | null {
  const element = t.kind === 'prop' ? t.owner : t.kind === 'element' ? t.name : null
  let best: { score: number; topic: string; block: DocBlock } | null = null
  for (const [topic, d] of Object.entries(index.topics)) {
    const lead = /^`([^`]+)`/.exec(d.summary)?.[1]
    const owns = element !== null && d.defines.includes(`<${element}>`)
    for (const b of d.blocks) {
      if (!b.keys.some(k => names(k, t))) continue
      const exact = b.keys.some(k => k === t.name || k === `<${element}>`)
      const score = WEIGHT[b.kind] + (lead && names(lead, t) ? 4 : 0) + (owns ? 5 : 0) + (exact ? 1 : 0)
      if (!best || score > best.score) best = { score, topic, block: b }
    }
  }
  if (!best) return null
  const text =
    best.block.kind === 'row'
      ? best.block.text
          .replace(/^\||\|$/g, '')
          .split(/(?<!\\)\|/)
          .map(c => c.trim().replace(/\\\|/g, '|'))
          .filter(Boolean)
          .join(' · ')
      : best.block.text
  return { topic: best.topic, line: best.block.line, text, url: `${DOCS_URL}${best.topic}` }
}

/** The excerpt for the token at an offset, null without one or without an index. */
export function docsExcerpt(sf: ts.SourceFile, offset: number): Excerpt | null {
  const index = docsIndex()
  const t = index && docTokenAt(sf, offset)
  return t ? excerptFor(index, t) : null
}

/** The excerpt as the hover's last paragraph. */
export const excerptMarkdown = (x: Excerpt): string => `${x.text}\n\n[${x.topic}.md](${x.url})`
