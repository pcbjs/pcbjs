// The gallery: one card per board of examples/, the basic path first, its numbers from siteBoards(), its text from examples/README.md
// and the entry's header comment.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo } from './.vitepress/topics'
import { siteBoards, type Board } from './boards'

export type { Board, View } from './boards'
export interface Card extends Omit<Board, 'file'> {
  summary: string
  source: string
}
export interface Basic extends Card {
  about: string
}
export interface Project {
  project: string
  about: string
  known: string
  boards: Card[]
}
export interface Examples {
  /** the boards of the README's Basic table, in its order */
  basic: Basic[]
  /** every other board by project, in the order of its Advanced table */
  advanced: Project[]
}

const github = 'https://github.com/pcbjs/pcbjs/blob/main/examples'
const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '')

/** examples/README.md's rows: a board as `<project>/<entry>` or a folder, with what it demonstrates and its known findings. */
function readme(): Map<string, { about: string; known: string }> {
  const rows = new Map()
  for (const line of read(join(repo, 'examples/README.md')).split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(c => c.trim())
    const key = /^`([^`]+)`$/.exec(cells[0] ?? '')?.[1]
    if (key) rows.set(key, { about: cells[1] ?? '', known: cells[2] ?? '' })
  }
  return rows
}

/** The first sentence of the entry's header comment, which by convention says what the board is. */
function headline(project: string, entry: string): string {
  const lines = read(join(repo, 'examples', project, entry)).split('\n')
  const end = lines.findIndex(l => !l.startsWith('//'))
  const comment = lines
    .slice(0, Math.max(0, end))
    .map(l => l.replace(/^\/\/\s*/, ''))
    .join(' ')
  return /^.*?\.(?=\s|$)/.exec(comment)?.[0] ?? comment
}

/** The basic boards in the order of examples/README.md's Basic table, then the other projects in the order of its rows. */
export async function gallery(): Promise<Examples> {
  const text = readme()
  const order = [...text.keys()]
  const basic: Basic[] = []
  const projects = new Map<string, Project>()
  // the absolute path stays on the build machine
  for (const { file: _, ...b } of (await siteBoards()).filter(b => !b.site)) {
    const card = { ...b, summary: headline(b.project, b.entry), source: `${github}/${b.project}/${b.entry}` }
    const row = text.get(`${b.project}/${b.entry}`)
    if (row) {
      basic.push({ ...card, about: row.about })
      continue
    }
    const top = b.project.split('/')[0]
    const p = projects.get(b.project) ?? { project: b.project, about: text.get(top)?.about ?? '', known: text.get(top)?.known ?? '', boards: [] }
    p.boards.push(card)
    projects.set(b.project, p)
  }
  const rank = (key: string) => {
    const i = order.indexOf(key)
    return i < 0 ? order.length : i
  }
  return {
    basic: basic.sort((a, b) => rank(`${a.project}/${a.entry}`) - rank(`${b.project}/${b.entry}`)),
    advanced: [...projects.values()].sort((a, b) => rank(a.project.split('/')[0]) - rank(b.project.split('/')[0]) || a.project.localeCompare(b.project)),
  }
}

/** Every board of the gallery, basic and advanced. */
export const cards = (g: Examples): Card[] => [...g.basic, ...g.advanced.flatMap(p => p.boards)]

export default {
  watch: ['../examples/README.md'],
  load: gallery,
}
