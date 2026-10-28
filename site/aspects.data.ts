// Width over height of every board SVG of scripts/boards.mjs by board id and view, so BoardSvg sizes its box before the SVG loads.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo } from './.vitepress/topics'
import type { Board, View } from './examples.data'

const file = join(repo, 'site/.gallery/boards.json')

export default {
  watch: ['./.gallery/boards.json'],
  load(): Record<string, Partial<Record<View, number>>> {
    const boards: Board[] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
    return Object.fromEntries(boards.map(b => [b.id, b.aspect]))
  },
}
