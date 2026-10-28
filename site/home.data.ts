// The home page's code and source map, written by scripts/boards.mjs: Blinky's layout as highlighted spans with its ranges, and each row's snippet.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo } from './.vitepress/topics'

export interface Range {
  ids: number[]
  refs: string[]
  chip: string
}
export interface Snippet {
  id: string
  file: string
  html: string
  drc?: { rule: string; message: string; src: string }
  findings?: number
}
export interface Home {
  hero: { id: string; file: string; html: string; ranges: Range[]; tour: number[] }
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
