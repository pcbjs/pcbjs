// The home page's code and source map from scripts/boards.mjs, Blinky's layout as highlighted spans with its ranges, and the
// snippets of the key cards by path; the cards themselves come from features.data.ts.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo } from './.vitepress/topics'
import { siteBoards, type View } from './boards'

export interface Range {
  /** the data-ids of the board SVG beside the code */
  ids: number[]
  /** the same items by uid, as the 3D view names them */
  uids: string[]
  refs: string[]
  chip: string
}
/** A board of the home page: its page id, the key of virtual:site-boards, and its views. */
export interface Shown {
  id: string
  name: string
  views: View[]
}
export interface Home {
  hero: Shown & { file: string; html: string; aspect: Partial<Record<View, number>>; ranges: Range[]; tour: number[] }
  /** a feature's snippet, highlighted, by its path from the repository root */
  snippets: Record<string, string>
  css: string
}

const file = join(repo, 'site/.gallery/home.json')

export default {
  watch: ['./.gallery/home.json'],
  async load(): Promise<Home> {
    if (!existsSync(file)) throw new Error('site/.gallery/home.json is missing: run scripts/boards.mjs first')
    const home = JSON.parse(readFileSync(file, 'utf8'))
    const boards = await siteBoards()
    const shown = (project: string, entry: string) => {
      const b = boards.find(x => x.project === project && x.entry === entry)
      if (!b) throw new Error(`the home page draws ${project}/${entry}, which did not compile`)
      return { id: b.id, name: b.name, views: b.views }
    }
    const { id, name, views } = shown('demo', home.hero.entry)
    return { ...home, hero: { ...home.hero, id, name, views } }
  },
}
