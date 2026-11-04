// The feature gallery: site/features/<category>/<id>.md, checked against docs/, the fixtures and the boards siteBoards() compiled,
// each joined with its board's page id; a dangling topic, fixture or board fails the build.
import { relative } from 'node:path'
import { CATEGORIES, checkFeatures, readFeatures } from './scripts/features.mjs'
import { repo } from './.vitepress/topics'
import { siteBoards, type Board, type View } from './boards'

export type Status = 'shipped' | 'beta' | 'planned'
export interface Feature {
  id: string
  category: string
  title: string
  status: Status
  summary?: string
  docs?: string
  flag?: string
  view?: View
  /** the key of virtual:site-boards */
  board?: string
  views?: View[]
  /** the board has its own page, /examples/<board>; a board of site/demos has none */
  page?: boolean
  /** the fixture's `#region show`, highlighted in home.json */
  snippet?: string
  key?: boolean
  /** a key card's board's first DRC error, printed under its snippet */
  drc?: Board['drc']
}
export interface Gallery {
  categories: string[]
  features: Feature[]
}

export async function features(): Promise<Gallery> {
  const boards = await siteBoards()
  const byFile = new Map(boards.map(b => [relative(repo, b.file).split('\\').join('/'), b]))
  const list = checkFeatures(readFeatures(), { boards: byFile })
  return {
    categories: CATEGORIES,
    features: list.map(f => {
      const b = f.fixture ? byFile.get(f.fixture) : undefined
      return {
        id: f.id,
        category: f.category,
        title: f.title,
        status: f.status,
        ...(f.summary ? { summary: f.summary, docs: f.docs, flag: f.flag, view: f.view } : {}),
        ...(b ? { board: b.id, views: b.views, page: !b.site } : {}),
        ...(f.snippet ? { snippet: f.snippet } : {}),
        ...(f.key ? { key: true, ...(b?.drc ? { drc: b.drc } : {}) } : {}),
      }
    }),
  }
}

export default {
  watch: ['./features/**/*.md'],
  load: features,
}
