// Binds the bare names of a `<PCB schematic={X}>` module in each design file, before esbuild, with a source map.
import MagicString from 'magic-string'
import { resolveFile, scopeInject } from '@pcbjs/compile/scope'
import type { Plugin } from 'vite'
import { wantsSourceRanges } from './source-ranges.js'

export function scopePlugin(rootOf: string | ((file: string) => string | null), exclude: string[] = []): Plugin {
  return {
    name: 'pcbjs:schematic-scope',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      const root = typeof rootOf === 'string' ? rootOf : rootOf(file)
      if (!root || !/\.tsx$/.test(file) || !wantsSourceRanges(id, root, exclude)) return null
      const inj = scopeInject(code, resolveFile, file)
      if (!inj) return null
      const s = new MagicString(code)
      s.appendLeft(inj.at, inj.text)
      return { code: s.toString(), map: s.generateMap({ hires: true, source: file, includeContent: true }) }
    },
  }
}
