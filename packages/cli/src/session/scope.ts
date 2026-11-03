// A scope of `events --scope` and `script --watch --scope`: references with `*` wildcards, a pattern also taking what sits under it, or plain file paths.

/** What an event touches: the references of the entities it concerns and the files, relative to the project; 'all' passes every scope. */
export type Touched = { refs: string[]; files: string[] } | 'all'

export interface Scope {
  patterns: string[]
  test(t: Touched): boolean
}

const FILE = /\.(c|m)?(j|t)sx?$/

const toRegex = (p: string) =>
  new RegExp(
    `^${p
      .split('*')
      .map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*')}(?:/.*)?$`,
  )

/** A pattern ending in a module extension is a file, any other a reference pattern. */
export function scopeOf(patterns: string[]): Scope {
  const files = patterns.filter(p => FILE.test(p)).map(p => p.replace(/^\.\//, ''))
  const refs = patterns.filter(p => !FILE.test(p)).map(toRegex)
  return {
    patterns,
    test(t) {
      if (t === 'all') return true
      return t.files.some(f => files.some(p => f === p || f.endsWith('/' + p))) || t.refs.some(r => refs.some(x => x.test(r)))
    },
  }
}
