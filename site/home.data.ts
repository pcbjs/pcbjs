// The home page's code and source map, written by scripts/boards.mjs: Blinky's layout as highlighted spans with its ranges, and each row's snippet.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo } from './.vitepress/topics'
import type { View } from './examples.data'

export interface Range {
  ids: number[]
  refs: string[]
  chip: string
}
/** A board of the home page: its viewer site's URL path, with the site's base, and its views. */
export interface Shown {
  id: string
  name: string
  viewer?: string
  views: View[]
}
export interface Snippet extends Shown {
  file: string
  html: string
  drc?: { rule: string; message: string; src: string }
  findings?: number
}
export interface Home {
  hero: Shown & { file: string; html: string; ranges: Range[]; tour: number[] }
  route: Snippet
  pour: Snippet
  drc: Snippet
  schematic: Snippet
  fab: { files: string[]; zip: string; status: string; html: string }
  css: string
}

const file = join(repo, 'site/.gallery/home.json')

export default {
  watch: ['./.gallery/home.json'],
  load(): Home {
    if (!existsSync(file)) throw new Error('site/.gallery/home.json is missing: run scripts/boards.mjs first')
    return JSON.parse(readFileSync(file, 'utf8'))
  },
}
