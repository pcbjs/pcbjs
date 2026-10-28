// The gallery: one card per board of examples/, its numbers and SVGs from scripts/boards.mjs, its text from examples/README.md and the entry's header comment.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo } from './.vitepress/topics'

export type View = '2d' | 'sch'
export interface Board {
  id: string
  project: string
  name: string
  entry: string
  stats: Record<string, number>
  routing?: Record<string, number>
  counts: Record<string, number>
  models?: Record<string, number>
  ms: number
  hash?: string
  packages?: string
  aspect: Partial<Record<View, number>>
  /** a board of site/demos, drawn on the home page and not in the gallery */
  site?: boolean
}
export interface Card extends Board {
  summary: string
  source: string
}
export interface Project {
  project: string
  about: string
  known: string
  source: string
  boards: Card[]
}

const github = 'https://github.com/pcbjs/pcbjs/tree/main/examples'
const site = join(repo, 'site')
const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '')

/** examples/README.md's table: folder, what it demonstrates, known findings. */
function readme(): Map<string, { about: string; known: string }> {
  const rows = new Map()
  for (const line of read(join(repo, 'examples/README.md')).split('\n')) {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(c => c.trim())
    const folder = /^`([^`]+)`$/.exec(cells[0] ?? '')?.[1]
    if (folder) rows.set(folder, { about: cells[1] ?? '', known: cells[2] ?? '' })
  }
  return rows
}

/** The first sentence of the entry's header comment, which by convention says what the board is. */
function headline(project: string, entry: string): string {
  const lines = read(join(repo, 'examples', project, entry)).split('\n')
  const comment = lines
    .slice(
      0,
      Math.max(
        0,
        lines.findIndex(l => !l.startsWith('//')),
      ),
    )
    .map(l => l.replace(/^\/\/\s*/, ''))
    .join(' ')
  return /^.*?\.(?=\s|$)/.exec(comment)?.[0] ?? comment
}

export default {
  watch: ['./.gallery/boards.json', '../examples/README.md'],
  load(): Project[] {
    // scripts/boards.mjs writes it before every build and dev server
    const boards: Board[] = JSON.parse(read(join(site, '.gallery/boards.json')) || '[]')
    const text = readme()
    const order = [...text.keys()]
    const projects = new Map<string, Project>()
    for (const b of boards.filter(b => !b.site)) {
      const top = b.project.split('/')[0]
      const p = projects.get(b.project) ?? {
        project: b.project,
        about: text.get(top)?.about ?? '',
        known: text.get(top)?.known ?? '',
        source: `${github}/${b.project}`,
        boards: [],
      }
      p.boards.push({ ...b, summary: headline(b.project, b.entry), source: `${github}/${b.project}/${b.entry}` })
      projects.set(b.project, p)
    }
    const rank = (p: string) => {
      const i = order.indexOf(p.split('/')[0])
      return i < 0 ? order.length : i
    }
    return [...projects.values()].sort((a, b) => rank(a.project) - rank(b.project) || a.project.localeCompare(b.project))
  },
}
